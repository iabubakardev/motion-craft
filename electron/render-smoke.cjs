// Real Player + worker + FFmpeg verification. Native output dialog is substituted.
const { app, dialog } = require("electron");
const fs = require("node:fs/promises"),
  syncFS = require("node:fs"),
  path = require("node:path");
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process"),
  { promisify } = require("node:util");
const { binary, probe } = require("./render-binaries.cjs");
const { verifyRender } = require("./verify-render.cjs");
const { createRenderSample } = require("../rendering/sample.cjs");
const { rebuildProject } = require("../core/project/operations.cjs");
const { buildComposition } = require("../rendering/input.cjs");
const directory = syncFS.mkdtempSync(path.join(__dirname, "../.next/render-smoke-"));
syncFS.mkdirSync(path.join(directory, "profile"));
app.setPath("userData", path.join(directory, "profile"));
let output = path.join(directory, "result.mp4"),
  imports = [];
dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: imports });
dialog.showMessageBox = async () => ({ response: 1 });
dialog.showMessageBoxSync = () => 1;
const timer = setTimeout(() => finish(new Error("Render integration timed out")), 180000);
function finish(error) {
  clearTimeout(timer);
  if (error) console.error(error);
  app.exit(error ? 1 : 0);
}
app.once("browser-window-created", (_event, window) => {
  const rendererErrors = [];
  window.webContents.on("console-message", (event) => {
    if (["error", "warning"].includes(event.level)) {
      console.log("Renderer:", event.message);
      if (/hydration|maximum update depth|uncaught|did not match/i.test(event.message || ""))
        rendererErrors.push(event.message);
    }
  });
  window.webContents.once("did-finish-load", async () => {
    const evaluate = (source) => window.webContents.executeJavaScript(source, true);
    const waitFor = async (source) => {
      for (let i = 0; i < 900; i++) {
        const result = await evaluate(source);
        if (result) return result;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`Timed out: ${source}`);
    };
    const click = async (text) => {
      await waitFor(
        `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`,
      );
      return evaluate(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
      );
    };
    try {
      const run = promisify(execFile);
      const video = path.join(directory, "source.mp4"),
        audio = path.join(directory, "source.wav"),
        image = path.join(directory, "source.png");
      const png = async (color) =>
        Buffer.from(
          await evaluate(
            `(()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');x.fillStyle=${JSON.stringify(color)};x.fillRect(0,0,320,180);return c.toDataURL('image/png').split(',')[1];})()`,
          ),
          "base64",
        );
      const red = await png("red"),
        blue = await png("blue");
      await new Promise((resolve, reject) => {
        const child = execFile(
          binary("ffmpeg"),
          [
            "-v",
            "error",
            "-y",
            "-f",
            "image2pipe",
            "-framerate",
            "30",
            "-vcodec",
            "png",
            "-i",
            "pipe:0",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            video,
          ],
          { windowsHide: true },
          (error) => (error ? reject(error) : resolve()),
        );
        child.stdin.end(Buffer.concat([...Array(30).fill(red), ...Array(30).fill(blue)]));
      });
      await run(
        binary("ffmpeg"),
        [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:sample_rate=48000:duration=2",
          "-c:a",
          "pcm_s16le",
          audio,
        ],
        { windowsHide: true },
      );
      await fs.writeFile(image, await png("yellow"));
      await waitFor(
        `!!window.motioncraft?.render && Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Import JSON'&&!b.disabled)`,
      );
      imports = [video, audio, image];
      const imported = await evaluate(`window.motioncraft.media.selectFiles()`);
      assert.equal(imported.assets.length, 3);
      let project = createRenderSample();
      project.assets = imported.assets.map((asset) => ({
        id: asset.id,
        filename: asset.filename,
        type: asset.type,
        mimeType: asset.mimeType,
        size: asset.size,
        importedAt: asset.importedAt,
        ...(asset.type !== "image" ? { duration: 2 } : { width: 320, height: 180 }),
      }));
      const vid = project.assets.find((a) => a.type === "video"),
        aud = project.assets.find((a) => a.type === "audio"),
        img = project.assets.find((a) => a.type === "image");
      project.tracks[3].clips = [
        {
          id: crypto.randomUUID(),
          assetId: vid.id,
          trackId: project.tracks[3].id,
          start: 0,
          duration: 1,
          sourceStart: 1,
          sourceEnd: 2,
        },
      ];
      project.tracks[4].clips = [
        {
          id: crypto.randomUUID(),
          assetId: aud.id,
          trackId: project.tracks[4].id,
          start: 0.5,
          duration: 1,
          sourceStart: 0.5,
          sourceEnd: 1.5,
        },
      ];
      const base = project.scenes[0].layers[0];
      project.scenes[0].layers.push({
        ...base,
        id: crypto.randomUUID(),
        trackId: project.tracks[0].id,
        type: "image",
        assetId: img.id,
        scale: 0.1,
        position: { x: -100, y: -50 },
        properties: { fit: "contain" },
      });
      project = rebuildProject(project);
      await click("Import JSON");
      await waitFor(`!!document.querySelector('textarea[aria-label="Project JSON"]')`);
      await evaluate(
        `(()=>{const e=document.querySelector('textarea[aria-label="Project JSON"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(JSON.stringify(project))});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await click("Validate and review");
      await waitFor(`!!document.querySelector('dialog[aria-label="Review project import"]')`);
      await click("Replace current project");
      await waitFor(
        `document.querySelector('[data-testid="project-name"]').textContent==='Render sample'`,
      );
      assert.equal(
        await evaluate(
          `Array.from(document.querySelectorAll('.monitor-modes button')).find(b=>b.textContent.trim()==='Timeline').getAttribute('aria-pressed')`,
        ),
        "true",
      );
      await waitFor(
        `document.querySelector('[aria-label="Timeline preview"] video')?.readyState>=2`,
      );
      console.log("CHECK: default timeline player decoded");
      await click("Source");
      const ruler = await evaluate(
        `(()=>{const r=document.querySelector('[aria-label="Timeline playhead"]').getBoundingClientRect(),z=Number(document.querySelector('[aria-label="Timeline zoom"]').value);return {x:Math.round(r.left+z*.5),y:Math.round(r.top+10)};})()`,
      );
      window.webContents.sendInputEvent({
        type: "mouseDown",
        ...ruler,
        button: "left",
        clickCount: 1,
      });
      window.webContents.sendInputEvent({
        type: "mouseUp",
        ...ruler,
        button: "left",
        clickCount: 1,
      });
      await waitFor(
        `Number(document.querySelector('[aria-label="Timeline timecode"]').value.split(':').pop())>=13 && Number(document.querySelector('[aria-label="Timeline timecode"]').value.split(':').pop())<=17 && !!document.querySelector('[aria-label="Timeline preview"] video')`,
      );
      console.log(
        "CHECK: source-to-timeline pointer seek",
        await evaluate(`document.querySelector('[aria-label="Timeline timecode"]').value`),
      );
      const initialCursor = await evaluate(
        `parseFloat(document.querySelector('[data-testid="timeline-playhead"]').style.left)`,
      );
      await evaluate(`document.querySelector('[aria-label="Play timeline preview"]').click()`);
      await waitFor(
        `parseFloat(document.querySelector('[data-testid="timeline-playhead"]').style.left)>${initialCursor}`,
      );
      await waitFor(`!!document.querySelector('[aria-label="Pause timeline preview"]')`);
      await evaluate(`document.querySelector('[aria-label="Pause timeline preview"]').click()`);
      const canvasBefore = await evaluate(
        `document.querySelector('.composition-artboard').getBoundingClientRect().width`,
      );
      await evaluate(`document.querySelector('[aria-label="Focus canvas"]').click()`);
      await waitFor(
        `document.querySelector('.composition-artboard').getBoundingClientRect().width>${canvasBefore}`,
      );
      const ratio = await evaluate(
        `(()=>{const r=document.querySelector('.composition-artboard').getBoundingClientRect();return r.width/r.height;})()`,
      );
      assert.ok(Math.abs(ratio - 320 / 180) < 0.01);
      await evaluate(`document.querySelector('[aria-label="Focus canvas"]').click()`);
      console.log(
        "PASS: default Timeline on empty-to-content mount, Source-to-timeline pointer navigation, play button moves visible playhead, focus canvas fits full aspect ratio",
      );
      await evaluate(
        `(()=>{const e=document.querySelector('[aria-label="Timeline timecode"]');e.value='00:00:00:10';e.form.requestSubmit();})()`,
      );
      await waitFor(
        `(()=>{const v=document.querySelector('[aria-label="Timeline preview"] video');return v&&v.readyState>=2&&!v.seeking&&Math.abs(v.currentTime-1.333333)<.15;})()`,
      );
      assert.equal(await evaluate(`!!document.querySelector('[data-composition-clip]')`), true);
      const previewPixel = await evaluate(
        `(()=>{const v=document.querySelector('[aria-label="Timeline preview"] video');const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;const x=c.getContext('2d');x.drawImage(v,0,0);return Array.from(x.getImageData(4,4,1,1).data);})()`,
      );
      assert.ok(
        previewPixel[2] > 180 && previewPixel[0] < 70,
        "preview must contain a decoded blue source frame",
      );
      console.log(
        "PASS: actual Player playback updates timeline, timeline seeking applies trimmed video source offset, images/text/shapes share composition",
      );
      const canvasCapture = await window.webContents.capturePage();
      await fs.writeFile(
        path.join(__dirname, "../.next/canvas-workspace-smoke.png"),
        canvasCapture.resize({ width: 1440 }).toPNG(),
      );
      await click("Export");
      await waitFor(`!!document.querySelector('dialog[aria-label="Export video"]')`);
      await click("Export MP4");
      const states = new Set();
      let job;
      for (let i = 0; i < 1200; i++) {
        job = await evaluate(`window.motioncraft.render.status()`);
        if (job) states.add(job.state);
        if (job && ["completed", "failed", "cancelled"].includes(job.state)) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(job?.state, "completed", JSON.stringify(job));
      assert.ok(states.has("rendering"));
      assert.equal(job.progress, 1);
      const metadata = verifyRender(
        await probe(output),
        buildComposition({ project, sources: {} }),
        true,
      );
      console.log("PASS: real MP4", JSON.stringify(metadata));
      const decoded = await run(
        binary("ffmpeg"),
        [
          "-v",
          "error",
          "-ss",
          "0.25",
          "-i",
          output,
          "-frames:v",
          "1",
          "-f",
          "image2pipe",
          "-vcodec",
          "png",
          "pipe:1",
        ],
        { windowsHide: true, encoding: "buffer" },
      );
      const pixel = await evaluate(
        `(async()=>{const image=new Image();image.src='data:image/png;base64,${decoded.stdout.toString("base64")}';await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d');context.drawImage(image,0,0);return Array.from(context.getImageData(4,4,1,1).data);})()`,
      );
      assert.ok(
        pixel[2] > 180 && pixel[0] < 70,
        "trimmed source must show blue, not the red first second",
      );
      const silence = await run(
        binary("ffmpeg"),
        [
          "-hide_banner",
          "-i",
          output,
          "-vn",
          "-af",
          "silencedetect=noise=-40dB:d=0.2",
          "-f",
          "null",
          "-",
        ],
        { windowsHide: true },
      );
      const initial = /silence_end:\s*([0-9.]+)/.exec(silence.stderr),
        ending = [...silence.stderr.matchAll(/silence_start:\s*([0-9.]+)/g)].pop();
      assert.ok(initial && Math.abs(Number(initial[1]) - 0.5) < 1 / 30);
      assert.ok(ending && Math.abs(Number(ending[1]) - 1.5) < 1 / 30);
      assert.ok((await fs.stat(output)).size > 1000);
      console.log(
        "PASS: decoded MP4 pixel verifies the source trim; H.264, AAC, resolution, FPS and exact video duration verified",
      );
      // A completed destination must survive cancellation of a subsequent job.
      const before = await fs.readFile(output);
      await click("Export MP4");
      await waitFor(
        `(async()=>{const s=await window.motioncraft.render.status();return s&&!['completed','failed','cancelled'].includes(s.state);})()`,
      );
      job = await evaluate(`window.motioncraft.render.status()`);
      await assert.rejects(evaluate(`window.motioncraft.render.start(${JSON.stringify(project)})`));
      await evaluate(`window.motioncraft.render.cancel(${JSON.stringify(job.id)})`);
      await waitFor(
        `(async()=>{const s=await window.motioncraft.render.status();return s?.state==='cancelled';})()`,
      );
      assert.deepEqual(await fs.readFile(output), before);
      await assert.rejects(evaluate(`window.motioncraft.render.cancel('../bad-id')`));
      console.log(
        "PASS: progress/lifecycle, conflicting export rejection, cancellation preserving the previous MP4, and validated cancellation IDs",
      );
      assert.deepEqual(rendererErrors, []);
      const capture = await window.webContents.capturePage();
      await fs.writeFile(
        path.join(__dirname, "../.next/render-preview-smoke.png"),
        capture.resize({ width: 1440 }).toPNG(),
      );
      console.log(`Verified output: ${output}`);
      await evaluate(
        `Array.from(document.querySelectorAll('dialog[aria-label="Export video"] button')).find(b=>['Hide','Close'].includes(b.textContent.trim())).click()`,
      );
      const portrait = { ...project, resolution: { width: 180, height: 320 }, aspectRatio: "9:16" };
      await click("Import JSON");
      await waitFor(`!!document.querySelector('textarea[aria-label="Project JSON"]')`);
      await evaluate(
        `(()=>{const e=document.querySelector('textarea[aria-label="Project JSON"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(JSON.stringify(portrait))});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await click("Validate and review");
      await waitFor(`!!document.querySelector('dialog[aria-label="Review project import"]')`);
      await click("Replace current project");
      await waitFor(
        `(()=>{const r=document.querySelector('.composition-artboard')?.getBoundingClientRect();return r&&Math.abs(r.width/r.height-180/320)<.01;})()`,
      );
      window.setMinimumSize(400, 400);
      for (const width of [1100, 820, 520]) {
        window.setContentSize(width, 800);
        await waitFor(
          `(()=>{const a=document.querySelector('.composition-artboard').getBoundingClientRect(),s=document.querySelector('.composition-stage').getBoundingClientRect();return a.width>0&&a.height>0&&a.left>=s.left&&a.right<=s.right+1&&a.top>=s.top&&a.bottom<=s.bottom+1&&Math.abs(a.width/a.height-180/320)<.01;})()`,
        );
      }
      assert.deepEqual(rendererErrors, []);
      console.log(
        "PASS: full portrait canvas fits its stage at desktop, tablet and narrow browser widths",
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      finish();
    } catch (error) {
      console.error(
        await evaluate("document.body.innerText.slice(-2500)").catch(() => "Renderer unavailable"),
      );
      finish(error);
    }
  });
});
require("./main.cjs");
