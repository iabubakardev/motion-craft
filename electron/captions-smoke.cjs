// Native Player/caption gesture/history/persistence and representative encoded frames for all presets.
const { app, dialog, nativeImage } = require("electron");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { execFile } = require("node:child_process"),
  { promisify } = require("node:util");
const { binary } = require("./render-binaries.cjs");
const { createCaptionSample } = require("../rendering/caption-sample.cjs");
const { captionRecords } = require("../core/captions/commands.cjs");
const project = createCaptionSample(),
  records = captionRecords(project);
const directory = fs.mkdtempSync(path.join(__dirname, "../.next/captions-smoke-"));
app.setPath("userData", path.join(directory, "profile"));
let destination = path.join(directory, "captions.mp4");
dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [destination] });
dialog.showMessageBox = async () => ({ response: 1 });
dialog.showMessageBoxSync = () => 1;
const timer = setTimeout(() => finish(new Error("Caption acceptance timed out")), 240000);
function finish(error) {
  clearTimeout(timer);
  if (error) console.error(error);
  app.exit(error ? 1 : 0);
}
app.once("browser-window-created", (_event, window) =>
  window.webContents.once("did-finish-load", async () => {
    console.log("CHECK: caption acceptance window loaded");
    const evaluate = (source) => window.webContents.executeJavaScript(source, true);
    const wait = async (source) => {
      for (let i = 0; i < 300; i++) {
        const v = await evaluate(source);
        if (v) return v;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("Timed out: " + source);
    };
    const click = async (label) => {
      await wait(
        `Array.from(document.querySelectorAll('button')).some(b=>(b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim()===${JSON.stringify(label)})&&!b.disabled)`,
      );
      await evaluate(
        `Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim()===${JSON.stringify(label)}).click()`,
      );
    };
    const exported = () =>
      evaluate(
        `(async()=>{const create=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;let blob;URL.createObjectURL=b=>{blob=b;return create.call(URL,b)};HTMLAnchorElement.prototype.click=()=>{};try{document.querySelector('[aria-label="Export JSON"]').click();}finally{URL.createObjectURL=create;HTMLAnchorElement.prototype.click=click;}return JSON.parse(await blob.text());})()`,
      );
    const seek = async (frame) => {
      await evaluate(
        `(()=>{const e=document.querySelector('[aria-label="Timeline preview position"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'${frame}');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    };
    try {
      console.log("CHECK: importing caption sample");
      await click("Import JSON");
      await wait(`!!document.querySelector('[aria-label="Project JSON"]')`);
      await evaluate(
        `(()=>{const e=document.querySelector('[aria-label="Project JSON"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(JSON.stringify(project))});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await click("Validate and review");
      await click("Replace current project");
      await wait(`!!document.querySelector('[data-caption-id="${records[0].layer.id}"]')`);
      const id = records[0].layer.id;
      await click("Select all captions");
      assert.equal(
        await evaluate(`document.querySelectorAll('[data-clip-id][aria-pressed="true"]').length`),
        6,
      );
      await click("delete timeline clips");
      await wait(`document.querySelectorAll('[data-clip-id]').length===0`);
      await click("Undo");
      await wait(`document.querySelectorAll('[data-clip-id]').length===6`);
      await click("Box select clips");
      await evaluate(
        `(()=>{const view=document.querySelector('[aria-label="Scrollable timeline"]'),first=document.querySelector('[data-clip-id="${records[0].layer.id}"]'),last=document.querySelector('[data-clip-id="${records[2].layer.id}"]'),a=first.getBoundingClientRect(),b=last.getBoundingClientRect();view.setPointerCapture=()=>{};first.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:90,button:0,clientX:a.left+8,clientY:a.top+6}));window.dispatchEvent(new PointerEvent('pointermove',{pointerId:90,clientX:b.right-8,clientY:b.bottom-6}));})()`,
      );
      await wait(
        `document.querySelectorAll('[data-clip-id][aria-pressed="true"]').length===3&&!!document.querySelector('[aria-label="Timeline selection rectangle"]')`,
      );
      await evaluate(
        `(()=>{const r=document.querySelector('[data-clip-id="${records[2].layer.id}"]').getBoundingClientRect();window.dispatchEvent(new PointerEvent('pointerup',{pointerId:90,clientX:r.right-8,clientY:r.bottom-6}));})()`,
      );
      await click("delete timeline clips");
      await wait(`document.querySelectorAll('[data-clip-id]').length===3`);
      assert.deepEqual(
        captionRecords(await exported()).map((r) => r.layer.id),
        records.slice(3).map((r) => r.layer.id),
      );
      await click("Undo");
      await wait(`document.querySelectorAll('[data-clip-id]').length===6`);
      await click("Select all captions");
      await evaluate(
        `(()=>{const first=document.querySelector('[data-clip-id="${records[0].layer.id}"]'),r=first.getBoundingClientRect();first.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:91,button:0,clientX:r.left+8,clientY:r.top+6}));window.dispatchEvent(new PointerEvent('pointermove',{pointerId:91,clientX:r.right-8,clientY:r.bottom-6}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));})()`,
      );
      assert.equal(
        await evaluate(`document.querySelectorAll('[data-clip-id][aria-pressed="true"]').length`),
        6,
      );
      await click("Box select clips");
      console.log(
        "PASS: select all captions, drag-box subset selection, delete/undo and Escape cancellation",
      );

      await click("Apply Documentary caption template");
      await wait(`!!document.querySelector('[aria-label="Caption text"]')`);
      assert.equal(
        await evaluate(`document.querySelector('[aria-label="Caption text"]').value`),
        records[0].layer.properties.text,
      );
      fs.writeFileSync(
        path.join(directory, "caption-editor.png"),
        (await window.webContents.capturePage()).toPNG(),
      );
      await click("Undo");
      console.log(
        "PASS: template gallery is visible without selection and applying a template opens editing controls",
      );

      // Native pointer capture is substituted only for the synthetic drag sequence.
      console.log("CHECK: sample loaded, testing gestures");
      await seek(30);
      await evaluate(
        `(()=>{const e=document.querySelector('[aria-label="Position caption ${id}"]');e.focus();e.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true}));})()`,
      );
      await wait(`Number(document.querySelector('[aria-label="Caption x"]')?.value)===.51`);
      await click("Undo");
      await wait(`Number(document.querySelector('[aria-label="Caption x"]')?.value)===.5`);
      await evaluate(
        `(()=>{const e=document.querySelector('[aria-label="Position caption ${id}"]'),r=e.getBoundingClientRect(),a=document.querySelector('[aria-label="Caption canvas controls"]').getBoundingClientRect();e.setPointerCapture=()=>{};e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:2,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));e.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:2,clientX:r.x+r.width/2+a.width*.1,clientY:r.y+r.height/2}));})()`,
      );
      await wait(
        `Number(document.querySelector('[data-caption-id="${id}"]').style.left.replace('px',''))>380`,
      );
      await evaluate(
        `document.querySelector('[aria-label="Position caption ${id}"]').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:2}))`,
      );
      let changed = await exported();
      assert.ok(Math.abs(captionRecords(changed)[0].layer.properties.caption.box.x - 0.6) < 0.001);
      await click("Undo");
      changed = await exported();
      assert.equal(captionRecords(changed)[0].layer.properties.caption.box.x, 0.5);
      await click("Redo");
      changed = await exported();
      assert.ok(Math.abs(captionRecords(changed)[0].layer.properties.caption.box.x - 0.6) < 0.001);
      await click("Undo");
      await evaluate(
        `(()=>{const handle=document.querySelector('[aria-label="Resize caption"]'),r=handle.getBoundingClientRect(),a=document.querySelector('[aria-label="Caption canvas controls"]').getBoundingClientRect();handle.setPointerCapture=()=>{};handle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:3,clientX:r.x,clientY:r.y}));handle.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:3,clientX:r.x-a.width*.05,clientY:r.y}));})()`,
      );
      await wait(`parseFloat(document.querySelector('[data-caption-id="${id}"]').style.width)<510`);
      await evaluate(
        `document.querySelector('[aria-label="Resize caption"]').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:3}))`,
      );
      assert.ok(
        Math.abs(captionRecords(await exported())[0].layer.properties.caption.box.width - 0.75) <
          0.001,
      );
      await click("Undo");
      await wait(
        `Math.abs(parseFloat(document.querySelector('[data-caption-id="${id}"]').style.width)-544)<.1`,
      );
      await evaluate(
        `(()=>{const handle=document.querySelector('[aria-label="Rotate caption"]'),r=handle.getBoundingClientRect(),a=document.querySelector('[aria-label="Caption canvas controls"]').getBoundingClientRect(),box=document.querySelector('[aria-label="Position caption ${id}"]').getBoundingClientRect();handle.setPointerCapture=()=>{};handle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:4,clientX:r.x,clientY:r.y}));handle.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:4,clientX:box.x+box.width/2+a.width*.1,clientY:box.y+box.height/2}));})()`,
      );
      await wait(
        `Math.abs(Number(document.querySelector('[data-caption-id="${id}"]').style.transform.split('rotate(')[1]?.split('deg')[0])-90)<.01`,
      );
      await evaluate(
        `document.querySelector('[aria-label="Rotate caption"]').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:4}))`,
      );
      assert.ok(
        Math.abs(captionRecords(await exported())[0].layer.properties.caption.box.rotation - 90) <
          0.02,
      );
      await click("Undo");
      await evaluate(`document.querySelector('[aria-label="Lock caption position"]').click()`);
      await evaluate(
        `document.querySelector('[aria-label="Position caption ${id}"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`,
      );
      assert.equal(captionRecords(await exported())[0].layer.properties.caption.box.x, 0.5);
      await click("Undo");
      await evaluate(
        `(()=>{const e=document.querySelector('[aria-label="Position caption ${id}"]'),r=e.getBoundingClientRect();e.setPointerCapture=()=>{};e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:5,clientX:r.x,clientY:r.y}));e.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:5,clientX:r.x+40,clientY:r.y+20}));e.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));})()`,
      );
      assert.equal(captionRecords(await exported())[0].layer.properties.caption.box.x, 0.5);
      console.log(
        "PASS: live resize/rotate, position lock and canceled gesture preserve atomic history",
      );
      assert.equal(
        await evaluate(
          `document.querySelector('[aria-label="Caption templates"]').querySelectorAll('button').length`,
        ),
        6,
      );
      await click("Show caption templates");
      await click("Apply Karaoke Highlight caption template");
      assert.ok(
        captionRecords(await exported()).every(
          (r) => r.layer.properties.caption.preset === "karaoke-highlight",
        ),
      );
      await wait(
        `document.querySelector('[data-caption-id="${id}"]').dataset.captionPreset==='karaoke-highlight'`,
      );
      await seek(21);
      await wait(
        `document.querySelector('[data-caption-id="${id}"] [data-caption-word="1"]')?.dataset.active==='true'`,
      );
      await evaluate(
        `(()=>{const e=document.querySelector('[aria-label="Caption playback text"]');e.value='word';e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
      await wait(
        `document.querySelectorAll('[data-caption-id="${id}"] [data-caption-word]').length===1`,
      );
      assert.equal(
        await evaluate(
          `document.querySelector('[data-caption-id="${id}"] [data-caption-word]').textContent`,
        ),
        "caption",
      );
      await click("Undo");
      await wait(
        `document.querySelectorAll('[data-caption-id="${id}"] [data-caption-word]').length===3`,
      );
      console.log(
        "PASS: templates affect all captions by default and word-only mode follows the spoken word",
      );

      await click("Undo");
      console.log(
        "PASS: caption canvas nudge/live drag/atomic undo/redo, inspector preset and frame-based karaoke",
      );
      await click("Show caption templates");
      for (const format of ["srt", "vtt"]) {
        const text = await evaluate(
          `(async()=>{const create=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;let blob;URL.createObjectURL=b=>{blob=b;return create.call(URL,b)};HTMLAnchorElement.prototype.click=()=>{};try{Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Export ${format.toUpperCase()}').click();}finally{URL.createObjectURL=create;HTMLAnchorElement.prototype.click=click;}return await blob.text();})()`,
        );
        const parsed = require("../core/captions/subtitles.cjs").parseSubtitles(text);
        assert.equal(parsed.length, 6);
      }
      await evaluate(
        `(()=>{const file=new File([${JSON.stringify("1\n00:00:13,000 --> 00:00:14,000\nImported subtitle")}], 'captions.srt',{type:'text/plain'});const data=new DataTransfer();data.items.add(file);const input=document.querySelector('[aria-label="Import subtitles"]');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
      await wait(`document.body.textContent.includes('Subtitles imported.')`);
      assert.equal(captionRecords(await exported()).length, 7);
      await click("Undo");
      assert.equal(captionRecords(await exported()).length, 6);
      console.log("PASS: SRT/VTT UI export and SRT UI import are undoable");

      const previews = [];
      for (let i = 0; i < records.length; i++) {
        await seek(i * 60 + 30);
        await wait(`!!document.querySelector('[data-caption-id="${records[i].layer.id}"]')`);
        const rect = await evaluate(
          `(()=>{const r=document.querySelector('.composition-artboard').getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}})()`,
        );
        const picture = (await window.webContents.capturePage(rect)).resize({
          width: 640,
          height: 360,
        });
        fs.writeFileSync(path.join(directory, `${i}-preview.png`), picture.toPNG());
        previews.push(picture.toBitmap());
      }
      await evaluate(`window.motioncraft.render.start(${JSON.stringify(project)})`);
      const job = await wait(
        `window.motioncraft.render.status().then(j=>j&&['completed','failed','cancelled'].includes(j.state)?j:false)`,
      );
      assert.equal(job.state, "completed", JSON.stringify(job));
      for (let i = 0; i < records.length; i++) {
        const { stdout } = await promisify(execFile)(
          binary("ffmpeg"),
          [
            "-v",
            "error",
            "-ss",
            String(i * 2 + 1),
            "-i",
            destination,
            "-frames:v",
            "1",
            "-f",
            "image2pipe",
            "-vcodec",
            "png",
            "pipe:1",
          ],
          { windowsHide: true, encoding: "buffer", maxBuffer: 8 * 1024 * 1024 },
        );
        fs.writeFileSync(path.join(directory, `${i}-export.png`), stdout);
        const bitmap = nativeImage.createFromBuffer(stdout).toBitmap();
        let total = 0,
          bright = 0,
          previewBright = 0,
          common = 0;
        for (let n = 0; n < bitmap.length; n += 4) {
          for (let k = 0; k < 3; k++) total += Math.abs(bitmap[n + k] - previews[i][n + k]);
          const exportedBright = Math.max(bitmap[n], bitmap[n + 1], bitmap[n + 2]) > 80;
          const visiblePreview =
            Math.max(previews[i][n], previews[i][n + 1], previews[i][n + 2]) > 80;
          if (exportedBright) bright++;
          if (visiblePreview) previewBright++;
          if (exportedBright && visiblePreview) common++;
        }
        assert.ok(bright > 100 && previewBright > 100, `preset ${i} rendered no caption pixels`);
        assert.ok(
          common / bright > 0.35,
          `preset ${i} preview/export caption glyph positions differ (${common / bright})`,
        );
        assert.ok(
          total / (640 * 360 * 3) < 12,
          `preset ${i} preview/export differs: ${total / (640 * 360 * 3)}`,
        );
      }
      destination = path.join(directory, "captions.motioncraft.json");
      const saved = await evaluate(
        `window.motioncraft.projects.save(${JSON.stringify(project)},true)`,
      );
      assert.equal(saved.status, "saved");
      const reopened = await evaluate(`window.motioncraft.projects.openFile()`);
      assert.equal(reopened.status, "ready");
      assert.deepEqual(
        captionRecords(reopened.project).map((r) => r.layer.properties.caption),
        records.map((r) => r.layer.properties.caption),
      );
      console.log(
        "PASS: all six preset preview/encoded frame comparisons and native caption save/reload",
      );
      console.log("Artifacts:", directory);
      finish();
    } catch (error) {
      console.error(await evaluate("document.body.innerText.slice(-1600)").catch(() => ""));
      finish(error);
    }
  }),
);
require("./main.cjs");
