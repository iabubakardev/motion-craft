const { app, dialog, nativeImage } = require("electron");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { binary, probe } = require("./render-binaries.cjs");
const { createTranscriptionSettings } = require("./transcription-settings.cjs");
const { createProject, rebuildProject } = require("../core/project/operations.cjs");
const directory = fs.mkdtempSync(path.join(__dirname, "../.next/audio-transcript-"));
app.setPath("userData", path.join(directory, "profile"));
createTranscriptionSettings(app.getPath("userData")).save({
  pythonPath: path.resolve("tools/motion-craft-ai/.venv/Scripts/python.exe"),
  workerPath: path.resolve("tools/motion-craft-ai/motion_craft_ai/worker.py"),
  model: "tiny",
  device: "cpu",
  computeType: "int8",
});
const png = nativeImage
  .createFromBitmap(Buffer.alloc(16 * 16 * 4, 255), { width: 16, height: 16 })
  .toPNG();
const video = path.join(directory, "speech.mp4"),
  silent = path.join(directory, "silent.mp4");
const frames = Buffer.concat(Array(180).fill(png));
execFileSync(
  binary("ffmpeg"),
  [
    "-v",
    "error",
    "-f",
    "image2pipe",
    "-framerate",
    "30",
    "-vcodec",
    "png",
    "-i",
    "pipe:0",
    "-i",
    path.resolve("tools/motion-craft-ai/test.mp3"),
    "-t",
    "6",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    video,
  ],
  { input: frames, windowsHide: true },
);
execFileSync(binary("ffmpeg"), ["-v", "error", "-i", video, "-an", "-c:v", "copy", silent], {
  windowsHide: true,
});
let incoming = video,
  destination = path.join(directory, "project.motioncraft.json");
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [incoming] });
dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
dialog.showMessageBox = async () => ({ response: 1 });
dialog.showMessageBoxSync = () => 1;
const timer = setTimeout(() => finish(new Error("Audio acceptance timed out")), 180000);
function finish(error) {
  clearTimeout(timer);
  if (error) console.error(error);
  app.exit(error ? 1 : 0);
}
app.once("browser-window-created", (_event, window) =>
  window.webContents.once("did-finish-load", async () => {
    const evaluate = (s) => window.webContents.executeJavaScript(s, true);
    const wait = async (s) => {
      for (let i = 0; i < 600; i++) {
        const v = await evaluate(s);
        if (v) return v;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("Timed out: " + s);
    };
    const click = async (label) => {
      const predicate = `e.getAttribute('aria-label')===${JSON.stringify(label)}||e.textContent.trim().replace(/^\\+\\s*/, "")===${JSON.stringify(label)}`;
      await wait(
        `Array.from(document.querySelectorAll('button')).some(e=>(${predicate})&&!e.disabled)`,
      );
      await evaluate(
        `Array.from(document.querySelectorAll('button')).find(e=>${predicate}).click()`,
      );
    };
    const exported = () =>
      evaluate(
        `(async()=>{const create=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;let blob;URL.createObjectURL=b=>{blob=b;return create.call(URL,b)};HTMLAnchorElement.prototype.click=()=>{};try{document.querySelector('[aria-label="Export JSON"]').click()}finally{URL.createObjectURL=create;HTMLAnchorElement.prototype.click=click}return JSON.parse(await blob.text())})()`,
      );
    try {
      console.log("CHECK: importing speech video");
      await click("Import media");
      const asset = await wait(
        `window.motioncraft.media.listAssets().then(a=>a.find(i=>i.type==='video'&&i.status!=='error'&&i.duration>0))`,
      );
      console.log("CHECK: inspecting approved source");
      const info = await evaluate(
        `window.motioncraft.ai.inspectAudio(${JSON.stringify(asset.id)})`,
      );
      assert.equal(info.hasAudio, true);
      const p = createProject(),
        track = p.tracks.find((t) => t.type === "video"),
        id = require("node:crypto").randomUUID();
      p.resolution = { width: 640, height: 360 };
      p.assets = [
        {
          id: asset.id,
          filename: asset.filename,
          type: asset.type,
          mimeType: asset.mimeType,
          size: asset.size,
          duration: asset.duration,
          importedAt: asset.importedAt,
        },
      ];
      track.clips = [
        {
          id,
          assetId: asset.id,
          trackId: track.id,
          start: 4,
          duration: 4,
          sourceStart: 1,
          sourceEnd: 5,
        },
      ];
      const projectFile = path.join(directory, "trimmed.motioncraft.json");
      fs.writeFileSync(projectFile, JSON.stringify(rebuildProject(p)));
      incoming = projectFile;
      console.log("CHECK: opening trimmed clip");
      await click("Open project");
      await wait(`!!document.querySelector('dialog[aria-label="Review project import"]')`);
      await click("Replace current project");
      await wait(`!!document.querySelector('[data-clip-id="${id}"]')`);
      await evaluate(
        `document.querySelector('[data-clip-id="${id}"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:400,clientY:500}))`,
      );
      await wait(
        `Array.from(document.querySelectorAll('[role="menuitem"]')).some(e=>e.textContent.trim()==='Detach Audio')`,
      );
      await evaluate(
        `Array.from(document.querySelectorAll('[role="menuitem"]')).find(e=>e.textContent.trim()==='Detach Audio').click()`,
      );
      await wait(`document.querySelectorAll('[data-clip-id]').length===2`);
      const detached = await exported(),
        audio = detached.tracks.flatMap((t) => t.clips).find((c) => c.audioOnly);
      assert.ok(audio);
      assert.equal(audio.sourceStart, 1);
      assert.equal(audio.sourceEnd, 5);
      assert.equal(audio.start, 4);
      assert.equal(audio.assetId, asset.id);
      assert.equal(detached.tracks.flatMap((t) => t.clips).find((c) => c.id === id).muted, true);
      await click("Undo");
      await wait(`document.querySelectorAll('[data-clip-id]').length===1`);
      await click("Redo");
      await wait(`document.querySelectorAll('[data-clip-id]').length===2`);
      await evaluate(
        `document.querySelector('[data-clip-id="${audio.id}"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:400,clientY:500}))`,
      );
      await evaluate(
        `Array.from(document.querySelectorAll('[role="menuitem"]')).find(e=>e.textContent.trim()==='Generate captions').click()`,
      );
      await wait(
        `document.querySelector('[aria-label="Transcription source"]')?.value===${JSON.stringify(asset.id)}`,
      );
      console.log("CHECK: transcribing selected range");
      await click("Start transcription");
      const job = await wait(
        `window.motioncraft.ai.status().then(j=>j?.state==='failed'||j?.state==='completed'?j:false)`,
      );
      assert.equal(job.state, "completed", JSON.stringify(job));
      const t = job.result.transcript;
      assert.deepEqual(t.context, {
        clipId: audio.id,
        sourceStart: 1,
        sourceEnd: 5,
        timelineStart: 4,
        rate: 1,
      });
      assert.ok(t.result.segments.length);
      assert.ok(t.result.segments.every((s) => s.start >= 1 && s.end <= 5.1));
      await wait(`!!document.querySelector('[aria-label="Transcript export format"]')`);
      await click("Start transcription");
      await wait(
        `document.querySelector('[aria-label="Transcription"]').textContent.includes('Reusing the matching reviewed transcript')`,
      );
      assert.equal((await evaluate("window.motioncraft.ai.status()")).id, job.id);
      for (const mode of ["word", "sentence", "duration", "smart"]) {
        await evaluate(
          `(()=>{const e=document.querySelector('[aria-label="Transcript grouping"]');e.value='${mode}';e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
        );
        if (mode === "duration")
          await evaluate(
            `(()=>{const e=document.querySelector('[aria-label="Grouping maxDuration"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'2');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
          );
        await wait(
          `document.querySelector('[aria-label="Transcript export preview"]').value.trim().length>0`,
        );
      }
      await click("Copy transcript");
      await wait(
        `document.querySelector('[aria-label="Transcript grouping and export"]').textContent.includes('Transcript copied.')`,
      );
      assert.match(require("electron").clipboard.readText(), /\(0:0[1-5]\)/);
      for (const format of ["txt", "inline", "lines", "srt", "vtt", "json", "csv"]) {
        await evaluate(
          `(()=>{const e=document.querySelector('[aria-label="Transcript export format"]');e.value='${format}';e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
        );
        destination = path.join(
          directory,
          "transcript." + (["inline", "lines"].includes(format) ? format + ".txt" : format),
        );
        await click("Save transcript file");
        for (let i = 0; i < 100 && !fs.existsSync(destination); i++)
          await new Promise((r) => setTimeout(r, 50));
        assert.ok(fs.readFileSync(destination, "utf8").trim());
      }
      await click("Generate Captions");
      await wait(`!document.querySelector('dialog[aria-label="Transcription"]')`);
      const generated = await exported(),
        captions = generated.tracks.filter((t) => t.name === "Captions").flatMap((t) => t.clips);
      assert.ok(captions.length);
      assert.ok(captions.every((c) => c.start >= 4 && c.start + c.duration <= 8.1));
      assert.equal(generated.transcripts[0].context.clipId, audio.id);
      destination = path.join(directory, "saved.motioncraft.json");
      await click("Save as");
      await wait(
        `document.querySelector('[aria-label="Project file controls"]').textContent.includes('Saved')`,
      );
      incoming = destination;
      const reopened = await evaluate("window.motioncraft.projects.openFile()");
      assert.deepEqual(reopened.project, generated);
      incoming = silent;
      await click("Import media");
      const noAudio = await wait(
        `window.motioncraft.media.listAssets().then(a=>a.find(i=>i.filename==='silent.mp4'&&i.status!=='error'))`,
      );
      assert.equal(
        (await evaluate(`window.motioncraft.ai.inspectAudio('${noAudio.id}')`)).hasAudio,
        false,
      );
      assert.ok((await probe(video)).streams.some((s) => s.codec_type === "audio"));
      console.log("CHECK: rendering detached audio and captions");
      destination = path.join(directory, "detached.mp4");
      await evaluate(`window.motioncraft.render.start(${JSON.stringify(generated)})`);
      const render = await wait(
        `window.motioncraft.render.status().then(j=>j&&['completed','failed','cancelled'].includes(j.state)?j:false)`,
      );
      assert.equal(render.state, "completed", JSON.stringify(render));
      assert.ok((await probe(destination)).streams.some((s) => s.codec_type === "audio"));
      const samples = (filename, start, duration) =>
        execFileSync(
          binary("ffmpeg"),
          [
            "-v",
            "error",
            "-ss",
            String(start),
            "-i",
            filename,
            "-t",
            String(duration),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            "-f",
            "wav",
            "pipe:1",
          ],
          { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
        );
      const rms = (b) => {
        const start = b.indexOf(Buffer.from("data")) + 8;
        assert.ok(start >= 8);
        let n = 0;
        for (let i = start; i + 2 <= b.length; i += 2) n += (b.readInt16LE(i) / 32768) ** 2;
        return Math.sqrt(n / ((b.length - start) / 2));
      };
      const reference = rms(samples(video, 1, 4)),
        rendered = rms(samples(destination, 4, 4));
      assert.ok(reference > 0.001);
      assert.ok(
        rendered / reference > 0.7 && rendered / reference < 1.3,
        `Unexpected audio gain: ${rendered / reference}`,
      );
      assert.ok(rms(samples(destination, 0, 3.8)) < 0.001, "Audio must not start before the clip");

      console.log(
        "PASS: real speech video, native audio inspection, UI detach/undo/redo, selected trimmed audio transcription, source timestamps, all seven export styles, caption placement and save/reopen. Silent video identified.",
      );
      console.log("Artifacts:", directory);
      finish();
    } catch (error) {
      console.error(await evaluate("document.body.innerText.slice(-2400)").catch(() => ""));
      finish(error);
    }
  }),
);
require("./main.cjs");
