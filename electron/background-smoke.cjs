const { app, dialog, nativeImage } = require("electron");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { binary } = require("./render-binaries.cjs");
const directory = fs.mkdtempSync(path.join(__dirname, "../.next/background-smoke-"));
app.setPath("userData", path.join(directory, "profile"));
const image = path.join(directory, "blue.png"),
  video = path.join(directory, "red.mp4");
const pixels = Buffer.alloc(16 * 16 * 4);
for (let i = 0; i < pixels.length; i += 4) {
  pixels[i] = 200;
  pixels[i + 1] = 80;
  pixels[i + 2] = 20;
  pixels[i + 3] = 255;
}
fs.writeFileSync(image, nativeImage.createFromBitmap(pixels, { width: 16, height: 16 }).toPNG());
const redPixels = Buffer.from(pixels);
for (let i = 0; i < redPixels.length; i += 4) {
  redPixels[i] = 20;
  redPixels[i + 2] = 200;
}
const redPng = nativeImage.createFromBitmap(redPixels, { width: 16, height: 16 }).toPNG();
try {
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
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      video,
    ],
    { windowsHide: true, input: Buffer.concat(Array(60).fill(redPng)) },
  );
} catch (error) {
  console.error(error);
  app.exit(1);
}
let incoming = image,
  destination = path.join(directory, "background.mp4");
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [incoming] });
dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
dialog.showMessageBox = async () => ({ response: 1 });
dialog.showMessageBoxSync = () => 1;
const timer = setTimeout(() => finish(new Error("Background acceptance timed out")), 180000);
function finish(error) {
  clearTimeout(timer);
  if (error) console.error(error);
  app.exit(error ? 1 : 0);
}
app.once("browser-window-created", (_event, window) =>
  window.webContents.once("did-finish-load", async () => {
    const evaluate = (s) => window.webContents.executeJavaScript(s, true);
    const wait = async (s) => {
      for (let i = 0; i < 300; i++) {
        const value = await evaluate(s);
        if (value) return value;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("Timed out: " + s);
    };
    const click = async (label) => {
      await wait(
        `Array.from(document.querySelectorAll('button')).some(e=>(e.getAttribute('aria-label')===${JSON.stringify(label)}||e.textContent.trim().replace('+ ','')===${JSON.stringify(label)})&&!e.disabled)`,
      );
      await evaluate(
        `Array.from(document.querySelectorAll('button')).find(e=>e.getAttribute('aria-label')===${JSON.stringify(label)}||e.textContent.trim().replace('+ ','')===${JSON.stringify(label)}).click()`,
      );
    };
    const exported = () =>
      evaluate(
        `(async()=>{const create=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;let blob;URL.createObjectURL=b=>{blob=b;return create.call(URL,b)};HTMLAnchorElement.prototype.click=()=>{};try{document.querySelector('[aria-label="Export JSON"]').click();}finally{URL.createObjectURL=create;HTMLAnchorElement.prototype.click=click;}return JSON.parse(await blob.text());})()`,
      );
    const background = (p) =>
      p.scenes
        .flatMap((s) => s.layers)
        .find((l) => l.trackId === p.tracks.find((t) => t.name === "Background").id);
    try {
      console.log("CHECK: importing background image");
      await click("Import media");
      await wait(
        `window.motioncraft.media.listAssets().then(a=>a.some(i=>i.type==='image'&&i.status==='ready'))`,
      );
      console.log("CHECK: setting image background");
      await click("Set image as background");
      await wait(`!!document.querySelector('[data-composition-clip] img')`);
      let p = await exported();
      const imageId = background(p).assetId;
      assert.equal(background(p).properties.fit, "cover");
      assert.equal(p.duration, 5);
      assert.ok(
        await evaluate(`document.querySelectorAll('[data-track-id]').length<${p.tracks.length}`),
      );
      await click("Show all timeline tracks");
      assert.equal(
        await evaluate(`document.querySelectorAll('[data-track-id]').length`),
        p.tracks.length,
      );
      await click("Show all timeline tracks");
      console.log("CHECK: image background placed");
      const beforeTracks = p.tracks.length;
      await click("Add visual track");
      assert.equal((await exported()).tracks.length, beforeTracks + 1);
      await click("Undo");
      await click("Add audio track");
      assert.equal((await exported()).tracks.length, beforeTracks + 1);
      await click("Undo");
      console.log("PASS: visual/audio track creation is available and undoable");
      incoming = video;
      await click("Import media");
      await wait(
        `window.motioncraft.media.listAssets().then(a=>a.some(i=>i.type==='video'&&i.status==='ready'&&i.duration))`,
      );
      console.log("CHECK: setting video background");
      await click("Set video as background");
      await wait(`!!document.querySelector('[data-composition-clip] video')`);
      p = await exported();
      const v = background(p);
      assert.equal(v.type, "video");
      assert.equal(v.properties.fit, "cover");
      assert.equal(v.properties.muted, true);
      assert.ok(v.duration <= 2.01);
      await click("Undo");
      assert.equal(background(await exported()).assetId, imageId);
      await click("Redo");
      assert.equal(background(await exported()).assetId, v.assetId);
      console.log(
        "PASS: image/video background UI, muted cover fit, compact/full track rows and atomic undo/redo",
      );
      const renderProject = { ...p, resolution: { width: 640, height: 360 } };
      await evaluate(`window.motioncraft.render.start(${JSON.stringify(renderProject)})`);
      const job = await wait(
        `window.motioncraft.render.status().then(j=>j&&['completed','failed','cancelled'].includes(j.state)?j:false)`,
      );
      assert.equal(job.state, "completed", JSON.stringify(job));
      for (const [time, expected] of [
        [1, [200, 80, 20]],
        [3, [17, 21, 28]],
      ]) {
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
          { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
        );
        const decoded = nativeImage.createFromBuffer(png),
          bitmap = decoded.toBitmap(),
          offset = (180 * decoded.getSize().width + 320) * 4,
          raw = [bitmap[offset + 2], bitmap[offset + 1], bitmap[offset]];
        for (let c = 0; c < 3; c++)
          assert.ok(
            Math.abs(raw[c] - expected[c]) < 12,
            `frame ${time}: ${raw.slice(0, 3)} vs ${expected}`,
          );
      }
      destination = path.join(directory, "background.motioncraft.json");
      assert.equal(
        (await evaluate(`window.motioncraft.projects.save(${JSON.stringify(p)},true)`)).status,
        "saved",
      );
      incoming = destination;
      const opened = await evaluate("window.motioncraft.projects.openFile()");
      assert.equal(opened.status, "ready");
      assert.deepEqual(background(opened.project), v);
      console.log("PASS: actual background MP4 pixels/duration and native save/reopen");
      console.log("Artifacts:", directory);
      finish();
    } catch (error) {
      console.error(await evaluate("document.body.innerText.slice(-1400)").catch(() => ""));
      finish(error);
    }
  }),
);
require("./main.cjs");
