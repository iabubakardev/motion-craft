// Real Electron renderer, pointer events, IPC and disk round trip. Native pickers are substituted.
const { app, dialog } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const syncFS = require("node:fs");
const path = require("node:path");
const { parseProjectJSON } = require("../core/project/schema.cjs");
const directory = syncFS.mkdtempSync(path.join(__dirname, "../.next/timeline-smoke-"));
syncFS.mkdirSync(path.join(directory, "profile"));
app.setPath("userData", path.join(directory, "profile"));
const opens = [],
  saves = [];
dialog.showOpenDialog = async () => opens.shift() || { canceled: true, filePaths: [] };
dialog.showSaveDialog = async () => saves.shift() || { canceled: true };
dialog.showMessageBoxSync = () => 1;
dialog.showMessageBox = async () => ({ response: 0 });
const timer = setTimeout(() => finish(new Error("Timeline integration timed out")), 60000);
function finish(error) {
  clearTimeout(timer);
  if (error) console.error(error);
  app.exit(error ? 1 : 0);
}
app.once("browser-window-created", (_event, window) => {
  const errors = [];
  window.webContents.on("console-message", (event) => {
    if (/hydration|maximum update depth|uncaught|did not match/i.test(event.message || ""))
      errors.push(event.message);
  });
  window.webContents.once("did-finish-load", async () => {
    const evaluate = async (source) => {
      try {
        return await window.webContents.executeJavaScript(source, true);
      } catch (error) {
        console.error("Renderer expression:", source);
        throw error;
      }
    };
    const waitFor = async (source) => {
      for (let i = 0; i < 160; i++) {
        if (await evaluate(source)) return;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error(`Timed out: ${source}`);
    };
    const click = (text) =>
      evaluate(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
      );
    const label = (label) =>
      evaluate(`document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}).click()`);
    const exported = () =>
      evaluate(
        `(async()=>{const make=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;let blob;URL.createObjectURL=function(v){blob=v;return make.call(URL,v);};HTMLAnchorElement.prototype.click=function(){};try{Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Export JSON').click();}finally{URL.createObjectURL=make;HTMLAnchorElement.prototype.click=click;}return JSON.parse(await blob.text());})()`,
      );
    const key = (source) =>
      evaluate(
        `document.querySelector('#timeline-panel').dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,${source}}))`,
      );
    const pointer = async (selector, dx, cancel = false) => {
      const point = await evaluate(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`,
      );
      window.webContents.sendInputEvent({ type: "mouseMove", ...point });
      window.webContents.sendInputEvent({
        type: "mouseDown",
        ...point,
        button: "left",
        clickCount: 1,
      });
      for (let i = 1; i <= 8; i++) {
        window.webContents.sendInputEvent({
          type: "mouseMove",
          x: point.x + Math.round((dx * i) / 8),
          y: point.y,
          button: "left",
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      if (cancel) await key("key:'Escape'");
      window.webContents.sendInputEvent({
        type: "mouseUp",
        x: point.x + dx,
        y: point.y,
        button: "left",
        clickCount: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 120));
    };
    try {
      await waitFor(
        `Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Save project' && !b.disabled)`,
      );
      const imagePath = path.join(directory, "still.png");
      const bytes = await evaluate(
        `(()=>{const c=document.createElement('canvas');c.width=320;c.height=180;c.getContext('2d').fillRect(0,0,320,180);return Array.from(Uint8Array.from(atob(c.toDataURL('image/png').split(',')[1]),v=>v.charCodeAt(0)));})()`,
      );
      await fs.writeFile(imagePath, Buffer.from(bytes));
      opens.push({ canceled: false, filePaths: [imagePath] });
      await evaluate(
        `window.dispatchEvent(new KeyboardEvent('keydown',{key:'o',ctrlKey:true,bubbles:true,cancelable:true}))`,
      );
      await waitFor(
        `document.querySelector('[data-testid="inspector-filename"]')?.textContent==='still.png'`,
      );
      await waitFor(`document.querySelector('ul[aria-label="Imported media"] button')?.draggable`);
      await waitFor(
        `document.querySelector('[data-testid="inspector-filename"]')?.textContent==='still.png' && document.body.textContent.includes('320 \u00d7 180')`,
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      let project = await exported(),
        track = project.tracks.find((t) => t.type === "video");
      await evaluate(
        `(()=>{const card=document.querySelector('ul[aria-label="Imported media"] button'),data=new DataTransfer();card.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:data}));const row=document.querySelector('[data-track-id="${track.id}"]'),rect=row.getBoundingClientRect();row.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data,clientX:rect.left+196,clientY:rect.top+15}));row.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data,clientX:rect.left+196,clientY:rect.top+15}));card.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:data}));})()`,
      );
      await waitFor(`document.querySelectorAll('[data-clip-id]').length===1`);
      project = await exported();
      let clip = project.tracks.flatMap((t) => t.clips)[0];
      assert.equal(clip.duration, 5);
      assert.equal(clip.sourceStart, null);
      const inserted = project;
      console.log(
        "PASS: imported local media drag/drop inserts an asset-backed clip through the renderer",
      );
      await evaluate(
        `(()=>{const input=document.querySelector('input[aria-label="Timeline zoom"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'12');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await waitFor(
        `Number(document.querySelector('input[aria-label="Timeline zoom"]').value)===12`,
      );
      await label("Toggle timeline snapping");
      await pointer(`[data-clip-id="${clip.id}"]`, 24);
      project = await exported();
      clip = project.tracks.flatMap((t) => t.clips)[0];
      assert.equal(clip.start, 2);
      await label("Undo");
      assert.deepEqual(await exported(), inserted);
      await label("Redo");
      assert.equal((await exported()).tracks.flatMap((t) => t.clips)[0].start, 2);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const beforeCancel = await exported();
      await pointer(`[data-clip-id="${clip.id}"]`, 24, true);
      assert.deepEqual(await exported(), beforeCancel);
      await pointer('[aria-label="Trim end still.png"]', -24);
      project = await exported();
      assert.equal(project.tracks.flatMap((t) => t.clips)[0].duration, 3);
      await evaluate(
        `(()=>{const e=document.querySelector('[aria-label="Clip start frame"]');e.value=90;e.form.requestSubmit();})()`,
      );
      project = await exported();
      assert.equal(project.tracks.flatMap((t) => t.clips)[0].start, 3);
      await evaluate(
        `(()=>{const e=document.querySelector('[aria-label="Timeline timecode"]');e.value='00:00:04:00';e.form.requestSubmit();})()`,
      );
      await key("key:'s'");
      project = await exported();
      assert.equal(project.tracks.flatMap((t) => t.clips).length, 2);
      assert.deepEqual(
        project.tracks
          .flatMap((t) => t.clips)
          .map((c) => c.duration)
          .sort(),
        [1, 2],
      );
      console.log(
        "PASS: real captured pointer move/trim, one-step undo/redo, inspector timing and frame-playhead split",
      );
      await key("key:'c',ctrlKey:true");
      await evaluate(
        `(()=>{const e=document.querySelector('[aria-label="Timeline timecode"]');e.value='00:00:10:00';e.form.requestSubmit();})()`,
      );
      await key("key:'v',ctrlKey:true");
      project = await exported();
      assert.equal(project.tracks.flatMap((t) => t.clips).length, 4);
      await key("key:'Delete'");
      project = await exported();
      assert.equal(project.tracks.flatMap((t) => t.clips).length, 2);
      await evaluate(
        `window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}))`,
      );
      assert.equal((await exported()).tracks.flatMap((t) => t.clips).length, 4);
      await evaluate(
        `window.dispatchEvent(new KeyboardEvent('keydown',{key:'y',ctrlKey:true,bubbles:true,cancelable:true}))`,
      );
      assert.equal((await exported()).tracks.flatMap((t) => t.clips).length, 2);
      await label(`Toggle lock ${track.name}`);
      assert.equal((await exported()).tracks.find((t) => t.id === track.id).locked, true);
      await label(`Toggle lock ${track.name}`);
      await label(`Toggle mute ${track.name}`);
      await label(`Toggle visibility ${track.name}`);
      const savePath = path.join(directory, "timeline.motioncraft.json");
      saves.push({ canceled: false, filePath: savePath });
      await click("Save project");
      await waitFor(
        `document.querySelector('[data-testid="save-indicator"]').textContent==='Saved'`,
      );
      const saved = JSON.parse(await fs.readFile(savePath, "utf8"));
      assert.equal(parseProjectJSON(JSON.stringify(saved)).success, true);
      await click("New project");
      await waitFor(`!!document.querySelector('dialog[aria-label="Create new project?"]')`);
      await click("Replace current project");
      await waitFor(`document.querySelectorAll('[data-clip-id]').length===0`);
      opens.push({ canceled: false, filePaths: [savePath] });
      await click("Open project");
      await waitFor(`!!document.querySelector('dialog[aria-label="Review project import"]')`);
      await click("Replace current project");
      await waitFor(`document.querySelectorAll('[data-clip-id]').length===2`);
      assert.deepEqual(await exported(), saved);
      const legacy = structuredClone(saved);
      legacy.schemaVersion = 1;
      delete legacy.animations;
      legacy.tracks = legacy.tracks.map((track) => ({
        id: track.id,
        name: track.name,
        type: track.type,
        order: track.order,
        clips: track.clips.map((clip) => ({
          ...clip,
          sourceStart: clip.sourceStart ?? 0,
          sourceEnd: clip.sourceEnd ?? clip.duration,
        })),
      }));
      const legacyPath = path.join(directory, "legacy.motioncraft.json");
      await fs.writeFile(legacyPath, JSON.stringify(legacy));
      opens.push({ canceled: false, filePaths: [legacyPath] });
      await click("Open project");
      await waitFor(
        `document.querySelector('dialog[aria-label="Review project import"]')?.textContent.includes('Schema v1 has been migrated')`,
      );
      await click("Replace current project");
      await waitFor(
        `document.querySelector('[data-testid="save-indicator"]').textContent==='Unsaved changes'`,
      );
      assert.equal((await exported()).schemaVersion, 3);
      assert.equal(JSON.parse(await fs.readFile(legacyPath, "utf8")).schemaVersion, 1);
      await click("Save project");
      await waitFor(
        `document.querySelector('[data-testid="save-indicator"]').textContent==='Saved'`,
      );
      assert.equal(JSON.parse(await fs.readFile(legacyPath, "utf8")).schemaVersion, 3);
      console.log(
        "PASS: native v1 migration is reviewed, marks the document dirty and writes v3 only on save",
      );
      assert.deepEqual(errors, []);
      const capture = await window.webContents.capturePage();
      await fs.writeFile(
        path.join(__dirname, "../.next/timeline-workspace-smoke.png"),
        capture.toPNG(),
      );
      console.log(
        "PASS: multi-clip copy/paste/delete, saved track flags and exact native save/new/reopen round trip",
      );
      console.log(
        "Native pickers are stubbed; media drag events are DOM-dispatched, clip gestures use Electron input events. Isolated test profile under .next.",
      );
      finish();
    } catch (error) {
      console.error(await evaluate("document.body.innerText.slice(0,6000)"));
      finish(error);
    }
  });
});
require("./main.cjs");
