// Opt-in real external-worker integration. No model downloads; isolated Electron profile.
const { app, dialog } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createTranscriptionSettings } = require("./transcription-settings.cjs");
const { transcriptSchema } = require("../core/transcription/schema.cjs");
const { secondsToFrames } = require("../core/timeline/time.cjs");
const python = process.env.MOTIONCRAFT_TRANSCRIPTION_PYTHON,
  worker = process.env.MOTIONCRAFT_TRANSCRIPTION_WORKER,
  audio = process.env.MOTIONCRAFT_TEST_AUDIO;
if (!python || !worker || !audio) {
  console.log(
    "SKIP: set MOTIONCRAFT_TRANSCRIPTION_PYTHON, MOTIONCRAFT_TRANSCRIPTION_WORKER and MOTIONCRAFT_TEST_AUDIO for the real transcription test.",
  );
  app.exit(0);
} else {
  const directory = fs.mkdtempSync(path.join(__dirname, "../.next/transcription-smoke-"));
  app.setPath("userData", directory);
  createTranscriptionSettings(directory).save({
    pythonPath: path.resolve(python),
    workerPath: path.resolve(worker),
    model: "tiny",
    device: "cpu",
    computeType: "int8",
  });
  let imports = [path.resolve(audio)];
  const destination = path.join(directory, "transcription.motioncraft.json");
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: imports });
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
  dialog.showMessageBox = async () => ({ response: 1 });
  dialog.showMessageBoxSync = () => 1;
  const timeout = setTimeout(() => finish(new Error("Transcription acceptance timed out")), 180000);
  function finish(error) {
    clearTimeout(timeout);
    if (error) console.error(error);
    app.exit(error ? 1 : 0);
  }
  app.once("browser-window-created", (_event, window) =>
    window.webContents.once("did-finish-load", async () => {
      const evaluate = (source) => window.webContents.executeJavaScript(source, true);
      const wait = async (source) => {
        for (let i = 0; i < 400; i++) {
          const value = await evaluate(source);
          if (value) return value;
          await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error("Timed out: " + source);
      };
      const click = async (label) => {
        await wait(
          `Array.from(document.querySelectorAll('button')).some(b=>(b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim().replace(/^\\+\\s*/, '')===${JSON.stringify(label)})&&!b.disabled)`,
        );
        await evaluate(
          `Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim().replace(/^\\+\\s*/, '')===${JSON.stringify(label)}).click()`,
        );
      };
      const exported = () =>
        evaluate(
          `(async()=>{const make=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;let blob;URL.createObjectURL=value=>{blob=value;return make.call(URL,value)};HTMLAnchorElement.prototype.click=()=>{};try{document.querySelector('[aria-label="Export JSON"]').click()}finally{URL.createObjectURL=make;HTMLAnchorElement.prototype.click=click}return JSON.parse(await blob.text())})()`,
        );
      try {
        await wait("!!window.motioncraft?.ai?.transcriptionSettings");
        const settingsFile = path.join(directory, "transcription-settings.json");
        const savedSettings = fs.readFileSync(settingsFile);
        fs.unlinkSync(settingsFile);
        const detected = await evaluate("window.motioncraft.ai.transcriptionSettings()");
        assert.equal(detected.available, true);
        assert.equal(detected.config.pythonPath, path.resolve(python));
        assert.equal(detected.config.workerPath, path.resolve(worker));
        assert.ok(detected.message.includes("tools/motion-craft-ai"));
        fs.writeFileSync(settingsFile, "{");
        await click("Transcribe");
        await wait(
          `document.querySelector('#transcription-start-help')?.textContent.includes('Choose Python and worker')`,
        );
        assert.ok(
          await evaluate(
            `document.querySelector('#transcription-start-help').textContent.includes('Select an imported audio or video')`,
          ),
        );
        assert.ok(
          await evaluate(
            `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Start transcription').disabled`,
          ),
        );
        await click("Close transcription");
        fs.unlinkSync(settingsFile);
        void savedSettings; // Keep the rest of acceptance on auto-detected defaults.
        console.log("PASS: disabled start explains missing worker and source.");
        console.log("CHECK: importing source");
        await click("Transcribe");
        assert.equal(
          await evaluate(
            `document.querySelector('[aria-label="Advanced transcription settings"]').open`,
          ),
          false,
        );
        await click("Choose audio file");
        await wait(`document.querySelector('[aria-label="Transcription source"]')?.value`);
        assert.ok(
          await evaluate(
            `document.querySelector('[aria-label="Transcription source"]').selectedOptions[0].textContent.includes(${JSON.stringify(path.basename(audio))})`,
          ),
        );
        await click("Close transcription");
        await wait(`document.body.textContent.includes(${JSON.stringify(path.basename(audio))})`);
        await click("AI Production");
        await wait(
          `document.querySelector('[aria-label="Transcription model"]')?.value === 'tiny'`,
        );
        assert.deepEqual(
          await evaluate(
            `Array.from(document.querySelector('[aria-label="Transcription model"]').options).map(o=>o.value).filter(Boolean)`,
          ),
          ["tiny", "base", "small", "medium"],
        );
        await wait(`window.motioncraft.ai.status().then(j=>j?.state==='completed')`);
        await evaluate(
          `(()=>{const e=document.querySelector('[aria-label="AI input type"]');e.value='narration';e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
        );
        await wait(`!!document.querySelector('[aria-label="Narration asset"]')`);
        await evaluate(
          `(()=>{const e=document.querySelector('[aria-label="Narration asset"]');e.value=e.options[1].value;e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
        );
        await click("Transcribe locally");
        const planningJob = await wait(
          `window.motioncraft.ai.status().then(j=>j&&j.result?.kind==='transcription'&&j.state==='completed'?j:false)`,
        );
        assert.ok(planningJob.result.transcript.result.segments.length);
        await wait(`!!document.querySelector('textarea[aria-label^="Transcript "]')`);
        await click("Close AI Production");
        console.log(
          "PASS: AI Production selects configured tiny model and reviews external transcription.",
        );
        const contextProject = await exported(),
          audioTrack = contextProject.tracks.find((t) => t.type === "audio");
        assert.equal(
          await evaluate(
            `document.querySelector('[aria-label="Caption templates"]').querySelectorAll('button').length`,
          ),
          6,
        );
        await evaluate(
          `(()=>{const card=document.querySelector('ul[aria-label="Imported media"] button'),data=new DataTransfer();card.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:data}));const row=document.querySelector('[data-track-id="${audioTrack.id}"]'),r=row.getBoundingClientRect();row.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data,clientX:r.left+196,clientY:r.top+15}));card.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:data}));})()`,
        );
        await wait(`document.querySelectorAll('[data-clip-id]').length===1`);
        const audioClip = (await exported()).tracks.flatMap((t) => t.clips)[0];
        await evaluate(
          `document.querySelector('[data-clip-id="${audioClip.id}"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:400,clientY:500}))`,
        );
        await wait(
          `Array.from(document.querySelectorAll('[role="menuitem"]')).some(e=>e.textContent.trim()==='Generate captions'&&!e.disabled)`,
        );
        await evaluate(
          `Array.from(document.querySelectorAll('[role="menuitem"]')).find(e=>e.textContent.trim()==='Generate captions').click()`,
        );
        await wait(
          `document.querySelector('[aria-label="Transcription source"]')?.value===${JSON.stringify(audioClip.assetId)}`,
        );
        assert.ok(
          await evaluate(`document.querySelector('[aria-label="Transcription source"]').disabled`),
        );
        assert.ok(
          await evaluate(
            `document.querySelector('dialog[aria-label="Transcription"] h2').textContent==='Generate captions'`,
          ),
        );
        await click("Close transcription");
        await click("Undo");
        await wait(`document.querySelectorAll('[data-clip-id]').length===0`);
        console.log(
          "PASS: audio right-click Generate captions preselects source and clip range; six templates visible before generation",
        );
        await click("Transcribe");
        console.log("CHECK: transcription panel opened");
        await wait(
          `document.querySelector('[aria-label="Selected transcription Python"]')?.value === ${JSON.stringify(path.resolve(python))}`,
        );
        assert.equal(
          await evaluate(
            `document.querySelector('[aria-label="Selected transcription worker"]').value`,
          ),
          path.resolve(worker),
        );
        assert.ok(
          await evaluate(
            `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Change Python and worker')`,
          ),
        );

        await wait(`document.querySelector('[aria-label="Transcription source"]')?.value`);
        await click("Start transcription");
        console.log("CHECK: transcription started");
        const job = await wait(
          `window.motioncraft.ai.status().then(j=>j&&['completed','failed'].includes(j.state)?j:false)`,
        );
        assert.equal(job.state, "completed", JSON.stringify(job));
        const transcript = transcriptSchema.parse(job.result.transcript);
        assert.ok(transcript.result.segments.length > 0);
        await wait(`!!document.querySelector('[aria-label="Transcript review"]')`);
        const segment = transcript.result.segments[0];
        await click("Seek transcript segment " + segment.id);
        await wait(
          `Math.abs(document.querySelector('[aria-label="Transcription source preview"]').currentTime-${segment.start})<0.05`,
        );
        await evaluate(
          `(()=>{const e=document.querySelector('[aria-label="Transcript text ${segment.id}"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Reviewed caption text');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
        );
        await click("Generate Captions");
        console.log("CHECK: generating captions");
        await wait(`!document.querySelector('dialog[aria-label="Transcription"]')`);
        const project = await exported();
        assert.equal(project.schemaVersion, 4);
        assert.equal(project.transcripts[0].result.segments[0].text, "Reviewed caption text");
        assert.equal(project.transcripts[0].originalSegments[0].text, segment.text);
        assert.ok(!JSON.stringify(project).includes(path.resolve(audio)));
        const track = project.tracks.find((t) => t.name === "Captions");
        assert.ok(track.clips.length > 0);
        assert.ok(track.clips.every((c) => c.duration > 0));
        await evaluate(`document.querySelector('[aria-label="Undo"]').click()`);
        await wait(`document.querySelectorAll('[data-clip-id]').length===0`);
        assert.equal((await exported()).transcripts.length, 0);
        await evaluate(`document.querySelector('[aria-label="Redo"]').click()`);
        await wait(`document.querySelectorAll('[data-clip-id]').length>0`);
        // Seek the real Player through its existing frame control.
        const target = secondsToFrames(segment.start, project.fps) + 1;
        await evaluate(
          `(()=>{const e=document.querySelector('[aria-label="Timeline preview position"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'${target}');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
        );
        await wait(
          `Array.from(document.querySelectorAll('div')).some(e=>e.textContent==='Reviewed caption text')`,
        );
        fs.writeFileSync(
          path.join(directory, "captions.png"),
          (await window.webContents.capturePage()).toPNG(),
        );
        await click("Save project");
        await wait(
          `document.querySelector('[aria-label="Project file controls"]').textContent.includes('Saved')`,
        );
        imports = [destination];
        const reopened = await evaluate("window.motioncraft.projects.openFile()");
        assert.equal(reopened.status, "ready");
        assert.deepEqual(reopened.project, project);
        await click("Open project");
        await wait(`!!document.querySelector('dialog[aria-label="Review project import"]')`);
        await click("Replace current project");
        await wait(`document.querySelectorAll('[data-clip-id]').length>0`);
        assert.deepEqual(await exported(), project);
        await click("Transcribe");
        await wait(
          `document.querySelector('[aria-label="Transcription"]').textContent.includes('Review saved transcript')`,
        );
        await click("Start transcription");
        await click("Cancel transcription");
        await wait(`window.motioncraft.ai.status().then(j=>j?.state==='cancelled')`);
        await click("Close transcription");
        assert.deepEqual(await exported(), project);
        console.log(
          "PASS: real tiny model, imported source, UI transcript/edit/seek, frame captions, atomic undo/redo, native save/reload and cancellation.",
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
}
