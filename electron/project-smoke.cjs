// Real renderer, IPC and filesystem round trips. Native dialog responses are substituted.
const { app, dialog } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const syncFS = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { projectSchema, parseProjectJSON } = require("../core/project/schema.cjs");

const testDirectory = syncFS.mkdtempSync(path.join(__dirname, "../.next/project-smoke-"));
syncFS.mkdirSync(path.join(testDirectory, "profile"));
app.setPath("userData", path.join(testDirectory, "profile"));
const openSelections = [];
const saveSelections = [];
let discardChoice = 0;
let discardPrompts = 0;
dialog.showOpenDialog = async () => openSelections.shift() || { canceled: true, filePaths: [] };
dialog.showSaveDialog = async () => saveSelections.shift() || { canceled: true };
dialog.showMessageBoxSync = () => {
  discardPrompts++;
  return discardChoice;
};
dialog.showMessageBox = async () => ({ response: 0 });
let timer;
const finish = (error) => {
  clearTimeout(timer);
  if (error) console.error(error);
  app.exit(error ? 1 : 0);
};
timer = setTimeout(() => finish(new Error("Project integration timed out")), 60000);

app.once("browser-window-created", (_event, window) => {
  const errors = [];
  window.webContents.on("console-message", (event) => {
    if (/hydration|maximum update depth|uncaught|did not match/i.test(event.message || ""))
      errors.push(event.message);
  });
  window.webContents.once("did-finish-load", async () => {
    const evaluate = (source) => window.webContents.executeJavaScript(source, true);
    const waitFor = async (source) => {
      for (let attempt = 0; attempt < 120; attempt++) {
        if (await evaluate(source)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Timed out: ${source}`);
    };
    const click = (text) =>
      evaluate(
        `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(text)}).click()`,
      );
    const edit = (label, value) =>
      evaluate(
        `(() => { const e=document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}); e.value=${JSON.stringify(String(value))}; e.dispatchEvent(new FocusEvent("focusout",{bubbles:true})); })()`,
      );
    const exported = () =>
      evaluate(`(async () => {
      const make=URL.createObjectURL, click=HTMLAnchorElement.prototype.click; let blob;
      URL.createObjectURL=function(value){blob=value;return make.call(URL,value);}; HTMLAnchorElement.prototype.click=function(){};
      try { Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Export JSON').click(); }
      finally { URL.createObjectURL=make; HTMLAnchorElement.prototype.click=click; }
      return JSON.parse(await blob.text());
    })()`);
    const pasteJSON = (value) =>
      evaluate(
        `(() => { const e=document.querySelector('textarea[aria-label="Project JSON"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true})); })()`,
      );
    try {
      await waitFor(
        `!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Save project').disabled`,
      );
      await evaluate(`document.querySelector('#tab-scenes').click()`);
      await click("+ Add scene");
      await waitFor(`!!document.querySelector('input[aria-label="Scene name"]')`);
      await edit("Scene name", "Opening");
      await edit("Scene duration", 7);
      await edit("Scene narration", "Keep my manual narration");
      await click("+ text");
      await waitFor(`!!document.querySelector('textarea[aria-label="Layer text"]')`);
      await edit("Layer text", "My manually edited title");
      await edit("Layer position x", 42);

      const imagePath = path.join(testDirectory, "source.png");
      const imageData = Buffer.from(
        await evaluate(
          `(() => { const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');x.fillStyle='#243d4c';x.fillRect(0,0,320,180);return Array.from(Uint8Array.from(atob(c.toDataURL('image/png').split(',')[1]),v=>v.charCodeAt(0))); })()`,
        ),
      );
      await fs.writeFile(imagePath, imageData);
      openSelections.push({ canceled: false, filePaths: [imagePath] });
      await evaluate(
        `window.dispatchEvent(new KeyboardEvent('keydown',{key:'o',ctrlKey:true,bubbles:true,cancelable:true}))`,
      );
      await waitFor(
        `document.querySelector('[data-testid="inspector-filename"]')?.textContent === 'source.png'`,
      );
      await waitFor(
        `(async () => (await window.motioncraft.media.listAssets()).every(a=>a.status==='ready'))()`,
      );
      await click("Add source to scene");
      await waitFor(`document.querySelectorAll('[aria-label="Scene layers"] li').length === 2`);
      let project = await exported();
      projectSchema.parse(project);
      assert.equal(project.scenes[0].name, "Opening");
      assert.equal(project.scenes[0].duration, 7);
      assert.equal(project.scenes[0].narration, "Keep my manual narration");
      assert.equal(project.scenes[0].layers[0].properties.text, "My manually edited title");
      assert.equal(project.scenes[0].layers[0].position.x, 42);
      assert.equal(project.tracks.flatMap((track) => track.clips).length, 2);
      console.log(
        "PASS: scene creation/rename/duration/narration, text and source layers, inspector edits and real timeline projections",
      );

      const savedPath = path.join(testDirectory, "original.motioncraft.json");
      saveSelections.push({ canceled: false, filePath: savedPath });
      await click("Save project");
      await waitFor(
        `document.querySelector('[data-testid="save-indicator"]').textContent === 'Saved'`,
      );
      const savedProject = JSON.parse(await fs.readFile(savedPath, "utf8"));
      assert.deepEqual(savedProject, project);
      assert.equal(JSON.stringify(savedProject).includes(testDirectory), false);
      await evaluate(
        `document.querySelector('[aria-label="Resize media sidebar"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}))`,
      );
      assert.equal(
        await evaluate(`document.querySelector('[data-testid="save-indicator"]').textContent`),
        "Saved",
      );
      await evaluate(`document.querySelector('#tab-scenes').click()`);
      await click("Duplicate");
      await waitFor(`document.querySelectorAll('[aria-label="Project scenes"] li').length === 2`);
      project = await exported();
      const duplicateId = project.scenes[1].id;
      assert.notEqual(duplicateId, savedProject.scenes[0].id);
      assert.notEqual(project.scenes[1].layers[0].id, savedProject.scenes[0].layers[0].id);
      assert.equal(project.scenes[1].layers[0].properties.text, "My manually edited title");
      await evaluate(`document.querySelector('button[aria-label="Move Opening copy up"]').click()`);
      await waitFor(
        `document.querySelector('[aria-label="Project scenes"] li').getAttribute('data-scene-id') === ${JSON.stringify(duplicateId)}`,
      );
      await edit("Scene duration", 2);
      await waitFor(
        `document.querySelector('[role="alert"]')?.textContent.includes('cut off a layer')`,
      );
      assert.equal((await exported()).scenes[0].duration, 7);
      await evaluate(
        `document.querySelector('button[aria-label="Dismiss project errors"]').click()`,
      );
      await edit("Scene duration", 8);
      await waitFor(`document.querySelector('input[aria-label="Scene duration"]').value === '8'`);
      assert.equal((await exported()).duration, 15);
      const deleteDuplicate = () =>
        evaluate(
          `Array.from(document.querySelector(${JSON.stringify(`[data-scene-id="${duplicateId}"]`)}).querySelectorAll('button')).find(b=>b.textContent==='Delete').click()`,
        );
      await deleteDuplicate();
      await waitFor(`!!document.querySelector('dialog[aria-label="Delete scene?"]')`);
      await click("Cancel");
      assert.equal((await exported()).scenes.length, 2);
      await deleteDuplicate();
      await waitFor(`!!document.querySelector('dialog[aria-label="Delete scene?"]')`);
      await click("Delete scene");
      await waitFor(`document.querySelectorAll('[aria-label="Project scenes"] li').length === 1`);
      await evaluate(`document.querySelector('button[aria-label="Undo"]').click()`);
      await waitFor(`document.querySelectorAll('[aria-label="Project scenes"] li').length === 2`);
      await evaluate(`document.querySelector('button[aria-label="Redo"]').click()`);
      await waitFor(`document.querySelectorAll('[aria-label="Project scenes"] li').length === 1`);
      await click("Save project");
      await waitFor(
        `document.querySelector('[data-testid="save-indicator"]').textContent === 'Saved'`,
      );
      console.log(
        "PASS: atomic save, path-free JSON, duplicate stable/unique IDs, reorder, protected duration changes, confirmed deletion and undo/redo",
      );

      const importProject = structuredClone(savedProject);
      importProject.id = randomUUID();
      importProject.name = "Imported project";
      const oldAssetId = importProject.assets[0].id;
      importProject.assets[0].id = randomUUID();
      for (const scene of importProject.scenes)
        for (const layer of scene.layers)
          if (layer.assetId === oldAssetId) layer.assetId = importProject.assets[0].id;
      await click("Import JSON");
      await waitFor(`!!document.querySelector('textarea[aria-label="Project JSON"]')`);
      await pasteJSON(JSON.stringify({ ...importProject, schemaVersion: 99 }));
      await click("Validate and review");
      await waitFor(
        `document.querySelector('dialog [role="alert"]')?.textContent.includes('schemaVersion')`,
      );
      assert.equal(
        await evaluate(`document.querySelector('[data-testid="project-name"]').textContent`),
        "Untitled project",
      );
      const uploadPath = path.join(testDirectory, "upload.json");
      await fs.writeFile(uploadPath, JSON.stringify(importProject));
      window.webContents.debugger.attach("1.3");
      const dom = await window.webContents.debugger.sendCommand("DOM.getDocument");
      const input = await window.webContents.debugger.sendCommand("DOM.querySelector", {
        nodeId: dom.root.nodeId,
        selector: 'input[aria-label="Upload project JSON"]',
      });
      await window.webContents.debugger.sendCommand("DOM.setFileInputFiles", {
        nodeId: input.nodeId,
        files: [uploadPath],
      });
      window.webContents.debugger.detach();
      await waitFor(
        `JSON.parse(document.querySelector('textarea[aria-label="Project JSON"]').value).schemaVersion === 4`,
      );
      await click("Validate and review");
      await waitFor(`!!document.querySelector('dialog[aria-label="Review project import"]')`);
      assert.equal(
        await evaluate(`document.querySelector('[data-testid="project-name"]').textContent`),
        "Untitled project",
      );
      await click("Cancel");
      assert.equal((await exported()).id, savedProject.id);
      await click("Import JSON");
      await waitFor(`!!document.querySelector('textarea[aria-label="Project JSON"]')`);
      await pasteJSON(JSON.stringify(importProject));
      await click("Validate and review");
      await waitFor(`!!document.querySelector('dialog[aria-label="Review project import"]')`);
      await click("Replace current project");
      await waitFor(
        `document.querySelector('[data-testid="project-name"]').textContent === 'Imported project'`,
      );
      assert.equal(
        await evaluate(
          `document.querySelector('button[aria-label="Undo"]').disabled && document.querySelector('button[aria-label="Redo"]').disabled`,
        ),
        true,
      );
      assert.equal(
        (await exported()).scenes[0].layers[0].properties.text,
        "My manually edited title",
      );
      console.log(
        "PASS: JSON paste/file upload, version errors, summary and explicit replacement/cancellation, history reset and preserved manual edits",
      );

      await evaluate(`document.querySelector('#tab-media').click()`);
      await waitFor(`!!document.querySelector('ul[aria-label="Imported media"] button')`);
      await evaluate(`document.querySelector('ul[aria-label="Imported media"] button').click()`);
      await waitFor(
        `Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Relink media')`,
      );
      const replacementPath = path.join(testDirectory, "relinked.png");
      await fs.writeFile(replacementPath, imageData);
      openSelections.push({ canceled: false, filePaths: [replacementPath] });
      await click("Relink media");
      await waitFor(
        `document.querySelector('[data-testid="inspector-filename"]')?.textContent === 'relinked.png'`,
      );
      await waitFor(
        `(async () => (await window.motioncraft.media.listAssets()).filter(a=>a.id===${JSON.stringify(importProject.assets[0].id)}).every(a=>a.status==='ready'))()`,
      );
      project = await exported();
      assert.equal(project.assets[0].id, importProject.assets[0].id);
      assert.equal(
        project.scenes[0].layers.find((layer) => layer.type === "image").assetId,
        importProject.assets[0].id,
      );
      const importedSavePath = path.join(testDirectory, "imported.motioncraft.json");
      saveSelections.push({ canceled: false, filePath: importedSavePath });
      await click("Save project");
      await waitFor(
        `document.querySelector('[data-testid="save-indicator"]').textContent === 'Saved'`,
      );
      const originalContents = await fs.readFile(savedPath, "utf8");
      openSelections.push({ canceled: false, filePaths: [savedPath] });
      await click("Open project");
      await waitFor(`!!document.querySelector('dialog[aria-label="Review project import"]')`);
      await click("Cancel");
      await evaluate(
        `document.querySelector('#tab-scenes').click(); document.querySelector('[aria-label="Project scenes"] button').click()`,
      );
      await waitFor(`!!document.querySelector('input[aria-label="Scene name"]')`);
      await edit("Scene name", "Imported edit");
      await waitFor(
        `document.querySelector('[data-testid="save-indicator"]').textContent === 'Unsaved changes'`,
      );
      await click("Save project");
      await waitFor(
        `document.querySelector('[data-testid="save-indicator"]').textContent === 'Saved'`,
      );
      assert.equal(await fs.readFile(savedPath, "utf8"), originalContents);
      assert.equal(
        JSON.parse(await fs.readFile(importedSavePath, "utf8")).scenes[0].name,
        "Imported edit",
      );
      await fs.unlink(imagePath);
      openSelections.push({ canceled: false, filePaths: [savedPath] });
      await click("Open project");
      await waitFor(`!!document.querySelector('dialog[aria-label="Review project import"]')`);
      await click("Replace current project");
      await waitFor(
        `document.querySelector('[data-testid="project-name"]').textContent === 'Untitled project'`,
      );
      assert.equal((await exported()).scenes[0].name, "Opening");
      await waitFor(`document.body.textContent.includes('1 media files need relinking')`);
      console.log(
        "PASS: native save/open round trips, missing-media detection, approved relinking with stable asset IDs and cancel-safe save destinations",
      );

      await evaluate(
        `document.querySelector('#tab-scenes').click(); document.querySelector('[aria-label="Project scenes"] button').click()`,
      );
      await waitFor(`!!document.querySelector('input[aria-label="Scene name"]')`);
      await edit("Scene name", "Unsaved sentinel");
      await waitFor(
        `document.querySelector('[data-testid="save-indicator"]').textContent === 'Unsaved changes'`,
      );
      window.webContents.reload();
      for (let attempt = 0; attempt < 100 && !discardPrompts; attempt++)
        await new Promise((resolve) => setTimeout(resolve, 50));
      assert.ok(discardPrompts > 0);
      assert.equal((await exported()).scenes[0].name, "Unsaved sentinel");
      assert.equal(JSON.parse(await fs.readFile(savedPath, "utf8")).scenes[0].name, "Opening");
      assert.deepEqual(errors, []);
      const capture = await window.webContents.capturePage();
      await fs.writeFile(
        path.join(__dirname, "../.next/project-workspace-smoke.png"),
        capture.resize({ width: 1440 }).toPNG(),
      );
      const invalid = path.join(testDirectory, "corrupted.json");
      await fs.writeFile(invalid, "{invalid");
      openSelections.push({ canceled: false, filePaths: [invalid] });
      await click("Open project");
      await waitFor(
        `document.querySelector('[role="alert"]')?.textContent.includes('Invalid JSON')`,
      );
      assert.equal((await exported()).scenes[0].name, "Unsaved sentinel");
      assert.equal(parseProjectJSON(await fs.readFile(savedPath, "utf8")).success, true);
      console.log(
        "PASS: dirty tracking, native unload cancellation, corrupted-file recovery, JSON export round trips and no hydration errors",
      );
      console.log(
        "Native dialog interaction is not automated. Test files/profile are isolated under .next.",
      );
      finish();
    } catch (error) {
      finish(error);
    }
  });
});

require("./main.cjs");
