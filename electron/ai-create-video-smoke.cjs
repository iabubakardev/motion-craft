// Real local-model end-to-end acceptance. Generated color cards are explicitly manual test visuals.
const { app, dialog, nativeImage } = require("electron");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { createProject } = require("../core/project/operations.cjs");
const { binary, probe } = require("./render-binaries.cjs");
const { verifyRender } = require("./verify-render.cjs");
const { buildComposition } = require("../rendering/input.cjs");
const { createTranscriptionSettings } = require("./transcription-settings.cjs");
const directory = fs.mkdtempSync(path.join(__dirname, "../.next/ai-create-video-"));
app.setPath("userData", path.join(directory, "profile"));
createTranscriptionSettings(app.getPath("userData")).save({
  pythonPath: path.resolve("tools/motion-craft-ai/.venv/Scripts/python.exe"),
  workerPath: path.resolve("tools/motion-craft-ai/motion_craft_ai/worker.py"),
  model: "tiny",
  device: "cpu",
  computeType: "int8",
});
const image = path.join(directory, "manual-test-card.png"),
  audio = path.resolve("tools/motion-craft-ai/test.mp3");
const pixels = Buffer.alloc(160 * 90 * 4);
for (let i = 0; i < pixels.length; i += 4) {
  pixels[i] = 190;
  pixels[i + 1] = 120;
  pixels[i + 2] = 35;
  pixels[i + 3] = 255;
}
fs.writeFileSync(image, nativeImage.createFromBitmap(pixels, { width: 160, height: 90 }).toPNG());
let incoming = [image, audio],
  destination = path.join(directory, "ai-video.motioncraft.json");
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: incoming });
dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
dialog.showMessageBox = async () => ({ response: 1 });
dialog.showMessageBoxSync = () => 1;
const timer = setTimeout(() => finish(new Error("AI video acceptance timed out")), 300000);
function finish(e) {
  clearTimeout(timer);
  if (e) console.error(e);
  app.exit(e ? 1 : 0);
}
app.once("browser-window-created", (_event, w) =>
  w.webContents.once("did-finish-load", async () => {
    const evaluate = (s) => w.webContents.executeJavaScript(s, true);
    const wait = async (s) => {
      for (let i = 0; i < 2500; i++) {
        const r = await evaluate(s);
        if (r) return r;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`Timed out: ${s}`);
    };
    const click = async (text) => {
      await wait(
        `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`,
      );
      await evaluate(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
      );
    };
    const fill = (selector, value) =>
      evaluate(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`,
      );
    const exported = () =>
      evaluate(
        `(async()=>{const create=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;let blob;URL.createObjectURL=b=>{blob=b;return create.call(URL,b)};HTMLAnchorElement.prototype.click=()=>{};try{document.querySelector('[aria-label="Export JSON"]').click()}finally{URL.createObjectURL=create;HTMLAnchorElement.prototype.click=click}return JSON.parse(await blob.text())})()`,
      );
    try {
      await wait("!!window.motioncraft?.ai");
      await wait(`!document.querySelector('[aria-label="Export JSON"]')?.disabled`);
      const imported = await evaluate("window.motioncraft.media.selectFiles()");
      assert.equal(imported.assets.length, 2);
      const project = createProject();
      project.assets = imported.assets.map((a) => ({
        id: a.id,
        filename: a.filename,
        type: a.type,
        mimeType: a.mimeType,
        size: a.size,
        importedAt: a.importedAt,
        ...(a.type === "audio" ? { duration: 31.344 } : { width: 160, height: 90 }),
      }));
      const narration = project.assets.find((a) => a.type === "audio"),
        visual = project.assets.find((a) => a.type === "image");
      const clip = {
        id: crypto.randomUUID(),
        assetId: narration.id,
        trackId: project.tracks.find((t) => t.name === "A1").id,
        start: 0,
        duration: 8,
        sourceStart: 1,
        sourceEnd: 9,
      };
      project.tracks.find((t) => t.name === "A1").clips = [clip];
      project.duration = 8;
      await click("Import JSON");
      await fill('[aria-label="Project JSON"]', JSON.stringify(project));
      await click("Validate and review");
      await click("Replace current project");
      await wait(`!!document.querySelector('[data-clip-id="${clip.id}"]')`);
      await evaluate(
        `document.querySelector('[data-clip-id="${clip.id}"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerId:1}));`,
      );
      await evaluate(`document.querySelector('[aria-label="AI Create Video"]').click()`);
      await wait(
        `document.querySelector('dialog[aria-label="AI Create Video"]')?.textContent.includes('selected clip range')`,
      );
      assert.equal(
        await evaluate(`!!document.querySelector('[aria-label="Video narration"]')`),
        false,
      );
      await wait(`window.motioncraft.ai.status().then(j=>j?.state==='completed')`);
      await fill('[aria-label="Video caption preset"]', "karaoke-highlight");
      console.log("CHECK: generating real scene plan");
      await click("Generate video plan");
      const review = await wait(
        `document.querySelector('[aria-label="Video plan review"]')?.textContent`,
      );
      assert.ok(review.includes("8.00 s"));
      const planJob = await evaluate("window.motioncraft.ai.status()");
      assert.equal(planJob.result.kind, "plan");
      assert.equal(planJob.result.plan.modelId, "qwen3:8b");
      fs.writeFileSync(
        path.join(directory, "scene-plan.json"),
        JSON.stringify(planJob.result.plan, null, 2),
      );
      const count = planJob.result.plan.scenes.length;
      for (let i = 1; i <= count; i++) {
        await fill(`[aria-label="Video asset ${i}"]`, visual.id);
        await fill(`[aria-label="Video animation ${i}"]`, "documentary-zoom");
      }
      await evaluate(
        `document.querySelector('[aria-label="Video plan review"] input[type="checkbox"]').click()`,
      );
      assert.equal(
        await evaluate(
          `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Assemble video').disabled`,
        ),
        true,
      );
      await evaluate(`document.querySelector('[aria-label="Replace existing timeline"]').click()`);
      console.log("CHECK: assembling reviewed plan");
      await click("Assemble video");
      await wait(`!document.querySelector('dialog[aria-label="AI Create Video"]')`);
      const generated = await exported();
      assert.ok(generated.transcripts.length);
      assert.ok(generated.transcripts[0].result.segments.some((s) => s.words.length));
      assert.equal(
        generated.tracks.flatMap((t) => t.clips).find((c) => c.assetId === narration.id)
          .sourceStart,
        1,
      );
      assert.equal(generated.resolution.width, 1920);
      assert.equal(generated.duration, 8);
      assert.ok(
        generated.scenes
          .flatMap((s) => s.layers)
          .filter((l) => l.type === "caption")
          .every((l) => l.properties.caption.preset === "karaoke-highlight"),
      );
      await evaluate(`document.querySelector('[aria-label="Undo"]').click()`);
      await wait(`document.querySelectorAll('[data-clip-id]').length===1`);
      assert.deepEqual(await exported(), project);
      await evaluate(`document.querySelector('[aria-label="Redo"]').click()`);
      await wait(`document.querySelectorAll('[data-clip-id]').length>2`);
      assert.deepEqual(await exported(), generated);
      await click("Save as");
      await wait(`document.querySelector('[data-testid="save-indicator"]').textContent==='Saved'`);
      incoming = [destination];
      const reopened = await evaluate("window.motioncraft.projects.openFile()");
      assert.deepEqual(reopened.project, generated);
      console.log("CHECK: persisted transcript reuse");
      const newClip = generated.tracks
        .flatMap((t) => t.clips)
        .find((c) => c.assetId === narration.id);
      await evaluate(
        `document.querySelector('[data-clip-id="${newClip.id}"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:2}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerId:2}));document.querySelector('[aria-label="AI Create Video"]').click()`,
      );
      await wait(`window.motioncraft.ai.status().then(j=>j?.state==='completed')`);
      await click("Generate video plan");
      await wait(
        `document.querySelector('dialog[aria-label="AI Create Video"]').textContent.includes('Reusing saved reviewed transcript')`,
      );
      await wait(`!!document.querySelector('[aria-label="Video plan review"]')`);
      await click("Close");
      await wait(`!!document.querySelector('[aria-label="Timeline preview"] img')`);
      await wait(`!document.querySelector('dialog[aria-label="AI Create Video"]')`);
      await evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
      await new Promise((r) => setTimeout(r, 150));
      fs.writeFileSync(
        path.join(directory, "workspace.png"),
        (await w.webContents.capturePage()).toPNG(),
      );
      console.log("CHECK: rendering actual 1080p MP4");
      destination = path.join(directory, "ai-video-1080p.mp4");
      await evaluate(`window.motioncraft.render.start(${JSON.stringify(generated)})`);
      const render = await wait(
        `window.motioncraft.render.status().then(j=>j&&['completed','failed','cancelled'].includes(j.state)?j:false)`,
      );
      assert.equal(render.state, "completed", JSON.stringify(render));
      const metadata = verifyRender(
        await probe(destination),
        buildComposition({ project: generated, sources: {} }),
        true,
      );
      const samples = (file, start, duration) =>
        execFileSync(
          binary("ffmpeg"),
          [
            "-v",
            "error",
            "-ss",
            String(start),
            "-i",
            file,
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
          { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
        );
      const rms = (b) => {
        const start = b.indexOf(Buffer.from("data")) + 8;
        assert.ok(start >= 8);
        let n = 0;
        for (let i = start; i + 1 < b.length; i += 2) n += (b.readInt16LE(i) / 32768) ** 2;
        return Math.sqrt(n / ((b.length - start) / 2));
      };
      const referencePCM = samples(audio, 1, 8),
        encodedPCM = samples(destination, 0, 8);
      const reference = rms(referencePCM),
        encoded = rms(encodedPCM);
      const envelope = (b) => {
        const data = b.indexOf(Buffer.from("data")) + 8,
          energy = [];
        for (let i = data; i + 320 <= b.length; i += 320) {
          let sum = 0;
          for (let j = 0; j < 320; j += 2) sum += b.readInt16LE(i + j) ** 2;
          energy.push(Math.sqrt(sum / 160));
        }
        return energy;
      };
      const originalEnvelope = envelope(referencePCM),
        outputEnvelope = envelope(encodedPCM);
      let envelopeCorrelation = -1,
        latencyMs = 0;
      for (let lag = -5; lag <= 5; lag++) {
        let xy = 0,
          xx = 0,
          yy = 0;
        for (let i = 6; i < Math.min(originalEnvelope.length, outputEnvelope.length) - 6; i++) {
          const x = originalEnvelope[i],
            y = outputEnvelope[i + lag];
          xy += x * y;
          xx += x * x;
          yy += y * y;
        }
        const correlation = xy / Math.sqrt(xx * yy);
        if (correlation > envelopeCorrelation) {
          envelopeCorrelation = correlation;
          latencyMs = lag * 10;
        }
      }
      assert.ok(
        envelopeCorrelation > 0.98 && Math.abs(latencyMs) <= 20,
        "Encoded speech must remain synchronized",
      );
      assert.ok(reference > 0.001);
      assert.ok(encoded / reference > 0.7 && encoded / reference < 1.3);
      for (const time of [0.1, 3.9, 7.8]) {
        const png = execFileSync(
          binary("ffmpeg"),
          [
            "-v",
            "error",
            "-ss",
            String(time),
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
          { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
        );
        const img = nativeImage.createFromBuffer(png),
          p = img.toBitmap();
        const center = (540 * 1920 + 960) * 4;
        assert.ok(
          Math.max(p[center], p[center + 1], p[center + 2]) > 140,
          "Visual coverage must not be a black gap",
        );
        fs.writeFileSync(path.join(directory, `frame-${time}.png`), png);
      }
      fs.writeFileSync(
        path.join(directory, "verification.json"),
        JSON.stringify(
          {
            metadata,
            envelopeCorrelation,
            latencyMs,
            referenceRms: reference,
            encodedRms: encoded,
            scenes: count,
            models: ["faster-whisper:tiny", "qwen3:8b"],
            manualTestVisual: true,
          },
          null,
          2,
        ),
      );
      console.log(
        "PASS: real Whisper + Qwen, auto selected trimmed narration, reviewed manual visual, atomic undo/redo, persistence, transcript reuse, 1080p H264/AAC MP4, decoded visual coverage and audio timing. Artifacts:",
        directory,
      );
      finish();
    } catch (e) {
      console.error(await evaluate("document.body.innerText.slice(-2400)").catch(() => ""));
      finish(e);
    }
  }),
);
require("./main.cjs");
