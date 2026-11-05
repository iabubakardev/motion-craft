// Real Player, timeline marker, undo/redo and encoded animation verification.
const { app, dialog } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { binary, probe } = require("./render-binaries.cjs");
const { verifyRender } = require("./verify-render.cjs");
const { createAnimationSample } = require("../rendering/animation-sample.cjs");
const { buildComposition } = require("../rendering/input.cjs");
const { pose } = require("../core/animation/engine.cjs");
const { basePose } = require("../core/animation/commands.cjs");
const project = createAnimationSample(),
  layer = project.scenes[0].layers[0];
const directory = fs.mkdtempSync(path.join(__dirname, "../.next/animation-smoke-"));
fs.mkdirSync(path.join(directory, "profile"));
app.setPath("userData", path.join(directory, "profile"));
const output = path.join(directory, "animation.mp4");
let destination = output;
dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [destination] });
dialog.showMessageBox = async () => ({ response: 1 });
dialog.showMessageBoxSync = () => 1;
const timer = setTimeout(() => finish(new Error("Animation smoke timed out")), 180000);
function finish(error) {
  clearTimeout(timer);
  if (error) console.error(error);
  app.exit(error ? 1 : 0);
}
app.once("browser-window-created", (_event, window) => {
  window.webContents.once("did-finish-load", async () => {
    const evaluate = (source) => window.webContents.executeJavaScript(source, true);
    const wait = async (source) => {
      for (let i = 0; i < 900; i++) {
        const value = await evaluate(source);
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`Timed out: ${source}`);
    };
    const click = async (text) => {
      await wait(
        `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`,
      );
      await evaluate(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
      );
    };
    try {
      await click("Import JSON");
      await wait(`document.querySelector('textarea[aria-label="Project JSON"]')!==null`);
      await evaluate(
        `(()=>{const e=document.querySelector('textarea[aria-label="Project JSON"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(JSON.stringify(project))});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await click("Validate and review");
      await click("Replace current project");
      await wait(
        `document.querySelector('[data-testid="project-name"]').textContent==='Animation sample'`,
      );
      await evaluate(`document.querySelector('[data-clip-id="${layer.id}"]').click()`);
      await wait(`!!document.querySelector('[aria-label="Animation properties"]')`);
      await evaluate(
        `document.querySelector('[aria-label="Keyframes at local frame 0"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`,
      );
      await wait(`!!document.querySelector('[aria-label="Keyframes at local frame 1"]')`);
      await evaluate(`document.querySelector('[aria-label="Undo"]').click()`);
      await wait(`!!document.querySelector('[aria-label="Keyframes at local frame 0"]')`);
      await evaluate(`document.querySelector('[aria-label="Redo"]').click()`);
      await wait(`!!document.querySelector('[aria-label="Keyframes at local frame 1"]')`);
      await evaluate(`document.querySelector('[aria-label="Undo"]').click()`);
      await wait(`!!document.querySelector('[aria-label="Keyframes at local frame 0"]')`);
      // Inject a complete pointer sequence without competing with the user's physical mouse.
      // Capture itself remains a manual Windows/high-DPI check; these exercise React gesture handlers.
      await evaluate(
        `(()=>{const marker=document.querySelector('[aria-label="Keyframes at local frame 0"]'),end=document.querySelector('[aria-label="Keyframes at local frame 59"]'),a=marker.getBoundingClientRect(),b=end.getBoundingClientRect();const capture=marker.setPointerCapture;marker.setPointerCapture=()=>{};try{for(const [type,x,buttons] of [['pointerdown',a.x+6,1],['pointermove',a.x+6+(b.x-a.x)/59*5,1],['pointerup',a.x+6+(b.x-a.x)/59*5,0]])marker.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:1,button:0,buttons,clientX:x,clientY:a.y+6}));}finally{marker.setPointerCapture=capture;}})()`,
      );
      await wait(`!!document.querySelector('[aria-label="Keyframes at local frame 5"]')`);
      await evaluate(`document.querySelector('[aria-label="Undo"]').click()`);
      await wait(`!!document.querySelector('[aria-label="Keyframes at local frame 0"]')`);
      console.log("PASS: timeline keyframe movement is undoable and redoable as one operation");
      const samples = [];
      for (const frame of [0, 15, 30, 59]) {
        const expected = pose(project.animations[layer.id].keyframes, basePose(layer), frame);
        const time = `00:00:${String(Math.floor(frame / 30)).padStart(2, "0")}:${String(frame % 30).padStart(2, "0")}`;
        await evaluate(
          `(()=>{const e=document.querySelector('[aria-label="Timeline timecode"]');e.value=${JSON.stringify(time)};e.form.requestSubmit();})()`,
        );
        await wait(
          `(()=>{const e=document.querySelector('[data-composition-clip="${layer.id}"]');return e&&Math.abs(Number(e.style.opacity)-${expected.opacity})<.00001;})()`,
        );
        await evaluate(
          `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`,
        );
        const point = await evaluate(
          `(()=>{const e=document.querySelector('[data-composition-clip="${layer.id}"]'),r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),translate:e.style.translate,scale:e.style.scale,rotate:e.style.rotate};})()`,
        );
        assert.ok(Math.abs(parseFloat(point.translate) - expected.x) < 0.0001);
        assert.ok(Math.abs(parseFloat(point.scale) - expected.scaleX) < 0.0001);
        assert.ok(Math.abs(parseFloat(point.rotate) - expected.rotation) < 0.0001);
        const screenshot = await window.webContents.capturePage({
          x: point.x,
          y: point.y,
          width: 1,
          height: 1,
        });
        const preview = await evaluate(
          `(async()=>{const i=new Image();i.src='data:image/png;base64,${screenshot.toPNG().toString("base64")}';await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const x=c.getContext('2d');x.drawImage(i,0,0);return Array.from(x.getImageData(0,0,1,1).data);})()`,
        );
        samples.push({
          frame,
          preview,
          x: Math.round(160 + expected.x),
          y: Math.round(90 + expected.y),
        });
      }
      console.log(
        "PASS: preview applies x/y, independent scales, rotation, opacity and nonlinear easing at four frames",
      );
      await evaluate(`window.motioncraft.render.start(${JSON.stringify(project)})`);
      const job = await wait(
        `(async()=>{const s=await window.motioncraft.render.status();return s&&['completed','failed','cancelled'].includes(s.state)?s:false;})()`,
      );
      assert.equal(job.state, "completed", JSON.stringify(job));
      verifyRender(await probe(output), buildComposition({ project, sources: {} }), false);
      for (const { frame, preview, x, y } of samples) {
        const decoded = await promisify(execFile)(
          binary("ffmpeg"),
          [
            "-v",
            "error",
            "-ss",
            String(frame / 30),
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
        const encoded = await evaluate(
          `(async()=>{const i=new Image();i.src='data:image/png;base64,${decoded.stdout.toString("base64")}';await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);return Array.from(ctx.getImageData(${x},${y},1,1).data).slice(0,3);})()`,
        );
        assert.equal(encoded.length, 3);
        encoded.forEach((value, i) =>
          assert.ok(
            Math.abs(value - preview[i]) < 20,
            `frame ${frame}: preview ${preview}, MP4 ${encoded}`,
          ),
        );
      }
      fs.writeFileSync(
        path.join(directory, "verification.json"),
        JSON.stringify({ output, samples }, null, 2),
      );
      console.log(
        "PASS: actual H.264 MP4 matches sampled preview pixels at frames 0, 15, 30 and 59",
      );
      console.log(`Artifact: ${output}`);
      destination = path.join(directory, "animation.motioncraft.json");
      const saved = await evaluate(
        `window.motioncraft.projects.save(${JSON.stringify(project)},true)`,
      );
      assert.equal(saved.status, "saved");
      assert.deepEqual(
        JSON.parse(fs.readFileSync(destination, "utf8")).animations,
        project.animations,
      );
      const reopened = await evaluate(`window.motioncraft.projects.openFile()`);
      assert.equal(reopened.status, "ready");
      assert.deepEqual(reopened.project.animations, project.animations);
      console.log(
        "PASS: native project save/open retains every animation key, ID, frame and easing",
      );
      finish();
    } catch (error) {
      console.error(await evaluate("document.body.innerText.slice(-1500)").catch(() => ""));
      finish(error);
    }
  });
});
require("./main.cjs");
