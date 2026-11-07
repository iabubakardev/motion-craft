const { app, dialog, nativeImage } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { execFileSync } = require("node:child_process");
const { binary } = require("./render-binaries.cjs");
const directory = fs.mkdtempSync(path.join(__dirname, "../.next/visual-smoke-"));
app.setPath("userData", path.join(directory, "profile"));
const image = path.join(directory, "visual.png"),
  pixels = Buffer.alloc(32 * 18 * 4);
for (let y = 0; y < 18; y++)
  for (let x = 0; x < 32; x++) {
    const i = (y * 32 + x) * 4;
    pixels[i] = x < 16 ? 0 : 230;
    pixels[i + 2] = x < 16 ? 230 : 0;
    pixels[i + 3] = 255;
  }
fs.writeFileSync(image, nativeImage.createFromBitmap(pixels, { width: 32, height: 18 }).toPNG());
const video = path.join(directory, "speed.mp4"),
  first = fs.readFileSync(image),
  secondPixels = Buffer.from(pixels);
for (let i = 0; i < secondPixels.length; i += 4) {
  const r = secondPixels[i + 2];
  secondPixels[i + 2] = secondPixels[i];
  secondPixels[i] = r;
}
const second = nativeImage.createFromBitmap(secondPixels, { width: 32, height: 18 }).toPNG();
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
  {
    input: Buffer.concat([...Array(30).fill(first), ...Array(30).fill(second)]),
    windowsHide: true,
  },
);
let incoming = image;
let destination = path.join(directory, "visual.mp4");
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [incoming] });
dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
dialog.showMessageBox = async () => ({ response: 1 });
dialog.showMessageBoxSync = () => 1;
const timer = setTimeout(() => finish(new Error("Visual acceptance timeout")), 150000);
function finish(e) {
  clearTimeout(timer);
  if (e) console.error(e);
  app.exit(e ? 1 : 0);
}
app.once("browser-window-created", (_, w) =>
  w.webContents.once("did-finish-load", async () => {
    const evaluate = (s) => w.webContents.executeJavaScript(s, true),
      wait = async (s) => {
        for (let i = 0; i < 400; i++) {
          const v = await evaluate(s);
          if (v) return v;
          await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error("Timed out " + s);
      };
    const click = async (label) => {
      const q = `e.getAttribute('aria-label')===${JSON.stringify(label)}||e.textContent.trim().replace(/^\\+\\s*/,'')===${JSON.stringify(label)}`;
      await wait(`Array.from(document.querySelectorAll('button')).some(e=>(${q})&&!e.disabled)`);
      await evaluate(`Array.from(document.querySelectorAll('button')).find(e=>${q}).click()`);
    };
    const exported = () =>
      evaluate(
        `(async()=>{const make=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;let blob;URL.createObjectURL=b=>{blob=b;return make.call(URL,b)};HTMLAnchorElement.prototype.click=()=>{};try{document.querySelector('[aria-label="Export JSON"]').click()}finally{URL.createObjectURL=make;HTMLAnchorElement.prototype.click=click}return JSON.parse(await blob.text())})()`,
      );
    const number = async (label, value) =>
      evaluate(
        `(()=>{const e=document.querySelector('[aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'${value}');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));})()`,
      );
    try {
      await click("Import media");
      await wait(`window.motioncraft.media.listAssets().then(a=>a.some(i=>i.width))`);
      const p = await exported(),
        track = p.tracks.find((t) => t.type === "video");
      await evaluate(
        `(()=>{const card=document.querySelector('ul[aria-label="Imported media"] button'),data=new DataTransfer();card.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:data}));const row=document.querySelector('[data-track-id="${track.id}"]'),r=row.getBoundingClientRect();row.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data,clientX:r.left+196,clientY:r.top+15}));card.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:data}));})()`,
      );
      const clip = await wait(
        `(()=>{const e=document.querySelector('[data-clip-id]');return e?.dataset.clipId})()`,
      );
      await evaluate(`document.querySelector('[data-clip-id="${clip}"]').click()`);
      await click("Timeline");
      await wait(`!!document.querySelector('[aria-label="Visual Position X"]')`);
      assert.ok(await evaluate(`!document.querySelector('#inspector-Basic').hidden`));
      await number("Visual Position X", 120);
      await wait(
        `document.querySelector('[data-composition-clip="${clip}"]').style.translate.startsWith('120px')`,
      );
      await click("Undo");
      await wait(
        `document.querySelector('[data-composition-clip="${clip}"]').style.translate.startsWith('0px')`,
      );
      const bounds = await evaluate(
        `(()=>{const r=document.querySelector('[aria-label="Transform visual ${clip}"]').getBoundingClientRect();return {x:r.x+r.width*.5,y:r.y+r.height*.5}})()`,
      );
      w.webContents.sendInputEvent({
        type: "mouseDown",
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        button: "left",
        clickCount: 1,
      });
      w.webContents.sendInputEvent({
        type: "mouseMove",
        x: Math.round(bounds.x + 30),
        y: Math.round(bounds.y + 10),
        button: "left",
      });
      await new Promise((r) => setTimeout(r, 100));
      w.webContents.sendInputEvent({
        type: "mouseUp",
        x: Math.round(bounds.x + 30),
        y: Math.round(bounds.y + 10),
        button: "left",
        clickCount: 1,
      });
      await wait(`document.querySelector('[aria-label="Visual Position X"]').value!=='0'`);
      await click("Undo");
      await click("Fill");
      await click("Flip horizontal");
      await evaluate(
        `document.querySelector('[aria-label="Crop left"]').closest('details').open=true`,
      );
      await number("Crop left", 25);
      await click("Transitions");
      await wait(`!!document.querySelector('#inspector-Transitions')`);
      await evaluate(
        `(()=>{const e=document.querySelector('#inspector-Transitions [aria-label="Visual entrance"]');e.value='fade';e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
      const edited = await exported(),
        visual = edited.tracks.flatMap((t) => t.clips).find((c) => c.id === clip).visual;
      assert.equal(visual.flipX, true);
      assert.equal(visual.crop.left, 0.25);
      assert.equal(visual.entrance, "fade");
      incoming = video;
      await click("Import media");
      await wait(
        `window.motioncraft.media.listAssets().then(a=>a.some(i=>i.filename==='speed.mp4'&&i.duration>0))`,
      );
      await evaluate(
        `(()=>{const card=Array.from(document.querySelectorAll('ul[aria-label="Imported media"] button')).find(e=>e.textContent.includes('speed.mp4')),data=new DataTransfer();card.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:data}));const row=document.querySelector('[data-track-id="${track.id}"]'),r=row.getBoundingClientRect();row.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data,clientX:r.left+196+6*(document.querySelector('[data-clip-id="${clip}"]').getBoundingClientRect().width/5),clientY:r.top+15}));card.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:data}));})()`,
      );
      const withVideo = await exported(),
        videoClip = withVideo.tracks
          .flatMap((t) => t.clips)
          .find((c) => c.assetId === withVideo.assets.find((a) => a.filename === "speed.mp4").id);
      assert.ok(videoClip);
      await evaluate(`document.querySelector('[data-clip-id="${videoClip.id}"]').click()`);
      await click("Basic");
      await wait(`!!document.querySelector('[aria-label="Clip playback speed"]')`);
      await evaluate(
        `(()=>{const e=document.querySelector('[aria-label="Clip playback speed"]');e.value='2';e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
      await wait(`document.querySelector('[aria-label="Clip duration frames"]').value==='30'`);
      const finalProject = await exported(),
        sped = finalProject.tracks.flatMap((t) => t.clips).find((c) => c.id === videoClip.id);
      assert.equal(sped.playbackRate, 2);
      assert.equal(sped.duration, 1);
      const renderProject = {
        ...finalProject,
        resolution: { width: 640, height: 360 },
        aspectRatio: "16:9",
      };
      await evaluate(`window.motioncraft.render.start(${JSON.stringify(renderProject)})`);
      const job = await wait(
        `window.motioncraft.render.status().then(j=>j&&['completed','failed'].includes(j.state)?j:false)`,
      );
      assert.equal(job.state, "completed", JSON.stringify(job));
      const png = execFileSync(
          binary("ffmpeg"),
          [
            "-v",
            "error",
            "-ss",
            "1",
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
          { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
        ),
        bitmap = nativeImage.createFromBuffer(png).toBitmap();
      const at = (x, y) => Array.from(bitmap.subarray((y * 640 + x) * 4, (y * 640 + x) * 4 + 3));
      assert.ok(at(50, 180)[0] > 180, JSON.stringify(at(50, 180)));
      assert.ok(
        at(590, 180).every((n) => n < 40),
        JSON.stringify(at(590, 180)),
      );
      const accelerated = execFileSync(
        binary("ffmpeg"),
        [
          "-v",
          "error",
          "-ss",
          String(sped.start + 0.75),
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
        { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      );
      const speedPixels = nativeImage.createFromBuffer(accelerated).toBitmap();
      assert.ok(
        speedPixels[(180 * 640 + 50) * 4] > 180,
        "2x playback must reach the second half of the source",
      );
      fs.writeFileSync(
        path.join(directory, "workspace.png"),
        (await w.webContents.capturePage()).toPNG(),
      );
      destination = path.join(directory, "visual.motioncraft.json");
      assert.equal(
        (await evaluate(`window.motioncraft.projects.save(${JSON.stringify(edited)},true)`)).status,
        "saved",
      );
      await click("Add text");
      await wait(`!!document.querySelector('[aria-label="Visual text"]')`);
      assert.ok((await exported()).scenes.flatMap((s) => s.layers).some((l) => l.type === "text"));
      console.log(
        "PASS: constant-speed video, selected visual inspector, live canvas drag/atomic undo, fit/fill, flip/crop/entrance, actual encoded pixels and native persistence.",
      );
      console.log("Artifacts:", directory);
      finish();
    } catch (e) {
      console.error(await evaluate("document.body.innerText.slice(-1600)").catch(() => ""));
      finish(e);
    }
  }),
);
require("./main.cjs");
