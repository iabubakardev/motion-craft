// Optional real Electron workflow. Inference is not faked: no models are downloaded.
// A labeled external-plan fixture tests review/apply/persistence/export separately.
const { app, dialog } = require("electron");
const fs = require("node:fs"),
  path = require("node:path");
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process"),
  { promisify } = require("node:util");
const { createProject } = require("../core/project/operations.cjs");
const { preparePlan } = require("../core/ai/planning.cjs");
const { binary, probe } = require("./render-binaries.cjs");
const { verifyRender } = require("./verify-render.cjs");
const { buildComposition } = require("../rendering/input.cjs");
const directory = fs.mkdtempSync(path.join(__dirname, "../.next/ai-smoke-"));
fs.mkdirSync(path.join(directory, "profile"));
app.setPath("userData", path.join(directory, "profile"));
let imports = [],
  destination = path.join(directory, "ai.motioncraft.json");
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: imports });
dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
dialog.showMessageBox = async () => ({ response: 1 });
dialog.showMessageBoxSync = () => 1;
const timer = setTimeout(() => finish(new Error("AI workflow timed out")), 180000);
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
        const result = await evaluate(source);
        if (result) return result;
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
    const fill = async (selector, value) =>
      evaluate(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`,
      );
    const exported = () =>
      evaluate(
        `(async()=>{const make=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;let blob;URL.createObjectURL=value=>{blob=value;return make.call(URL,value);};HTMLAnchorElement.prototype.click=()=>{};try{Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Export JSON').click();}finally{URL.createObjectURL=make;HTMLAnchorElement.prototype.click=click;}return JSON.parse(await blob.text());})()`,
      );
    try {
      await wait(`!!window.motioncraft?.ai`);
      const image = path.join(directory, "forest.png"),
        audio = path.join(directory, "narration.wav");
      const png = await evaluate(
        `(()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');x.fillStyle='#20c080';x.fillRect(0,0,320,180);return c.toDataURL('image/png').split(',')[1];})()`,
      );
      fs.writeFileSync(image, Buffer.from(png, "base64"));
      await promisify(execFile)(
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
      imports = [image, audio];
      const imported = await evaluate("window.motioncraft.media.selectFiles()");
      assert.equal(imported.assets.length, 2);
      const project = createProject();
      project.resolution = { width: 320, height: 180 };
      project.assets = imported.assets.map((a) => ({
        id: a.id,
        filename: a.filename,
        type: a.type,
        mimeType: a.mimeType,
        size: a.size,
        importedAt: a.importedAt,
        ...(a.type === "audio" ? { duration: 2 } : { width: 320, height: 180 }),
      }));
      await click("Import JSON");
      await wait(`!!document.querySelector('[aria-label="Project JSON"]')`);
      await fill('[aria-label="Project JSON"]', JSON.stringify(project));
      await click("Validate and review");
      await click("Replace current project");
      await wait(`document.querySelectorAll('[data-clip-id]').length===0`);
      await evaluate(`document.querySelector('[aria-label="AI Production"]').click()`);
      const detection = await wait(
        `(async()=>{const job=await window.motioncraft.ai.status();return job?.state==='completed'?job:false;})()`,
      );
      assert.equal(detection.result.kind, "runtime");
      await wait(`!!document.querySelector('[aria-label="Ollama connection status"]')`);
      const connectionText = await evaluate(
        `document.querySelector('[aria-label="Ollama connection status"]').textContent`,
      );
      if (detection.result.runtime.ollama.running)
        assert.ok(connectionText.includes(detection.result.runtime.ollama.version));
      if (detection.result.runtime.ollama.running && !detection.result.runtime.ollama.models.length)
        assert.ok(connectionText.includes("no local models"));
      console.log(
        "PASS: AI modal automatically detects and displays Ollama connection/version/model availability",
      );
      console.log("Real runtime:", JSON.stringify(detection.result.runtime));
      const narration = project.assets.find((a) => a.type === "audio"),
        visual = project.assets.find((a) => a.type === "image");
      const transcript = {
        version: 1,
        id: crypto.randomUUID(),
        sourceAssetId: narration.id,
        language: "en",
        text: "Forest sunlight.",
        duration: 2,
        model: {
          engine: "faster-whisper",
          name: "external-test-fixture",
          device: "cpu",
          computeType: "int8",
        },
        segments: [{ id: crypto.randomUUID(), start: 0.125, end: 1.875, text: "Forest sunlight." }],
      };
      const plan = preparePlan(
        { kind: "transcript", transcript },
        {
          fps: 30,
          aspectRatio: "16:9",
          style: "default",
          minSeconds: 2,
          maxSeconds: 4,
          wordsPerMinute: 150,
          instructions: "",
          temperature: 0.2,
        },
        crypto.randomUUID(),
      );
      plan.scenes = plan.scenes.map((s) => ({
        ...s,
        visualDescription: "Forest trees in warm sunlight",
        keywords: ["forest"],
        animation: "fade-in",
      }));
      console.log("CHECK: importing external plan");
      await evaluate(
        `document.querySelector('[aria-label="AI JSON"]').closest('details').open=true`,
      );
      await fill('[aria-label="AI JSON"]', JSON.stringify(plan));
      await click("Validate AI JSON");
      await wait(`!!document.querySelector('[aria-label="Asset for scene 1"]')`);
      console.log("CHECK: plan review visible");
      await fill('[aria-label="Asset for scene 1"]', visual.id);
      assert.equal(
        await evaluate(
          `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Append approved plan').disabled`,
        ),
        true,
      );
      await evaluate(`document.querySelector('[aria-label="Approve AI plan"]').click()`);
      await click("Append approved plan");
      await wait(`document.querySelectorAll('[data-clip-id]').length===3`);
      const result = await exported();
      assert.equal(result.scenes.length, 1);
      assert.equal(result.scenes[0].layers.filter((l) => l.type === "caption").length, 1);
      assert.equal(result.tracks.find((t) => t.name === "A1").clips[0].assetId, narration.id);
      assert.equal(result.tracks.find((t) => t.name === "V4").clips[0].start, 0.125);
      assert.ok(Object.keys(result.animations).length);
      await evaluate(`document.querySelector('[aria-label="Undo"]').click()`);
      await wait(`document.querySelectorAll('[data-clip-id]').length===0`);
      await evaluate(`document.querySelector('[aria-label="Redo"]').click()`);
      await wait(`document.querySelectorAll('[data-clip-id]').length===3`);
      console.log(
        "PASS: reviewed external plan, explicit asset choice, approval, real caption/audio/visual clips and single-step undo/redo",
      );
      await click("Save project");
      await wait(`document.querySelector('[data-testid="save-indicator"]').textContent==='Saved'`);
      assert.deepEqual(JSON.parse(fs.readFileSync(destination, "utf8")), result);
      imports = [destination];
      const reopened = await evaluate("window.motioncraft.projects.openFile()");
      assert.equal(reopened.status, "ready");
      assert.deepEqual(reopened.project, result);
      destination = path.join(directory, "ai.mp4");
      await evaluate(`window.motioncraft.render.start(${JSON.stringify(result)})`);
      const render = await wait(
        `(async()=>{const job=await window.motioncraft.render.status();return job&&['completed','failed','cancelled'].includes(job.state)?job:false;})()`,
      );
      assert.equal(render.state, "completed", JSON.stringify(render));
      const metadata = verifyRender(
        await probe(destination),
        buildComposition({ project: result, sources: {} }),
        true,
      );
      console.log("PASS: native save/open and actual project MP4", JSON.stringify(metadata));
      await assert.rejects(
        evaluate(
          `window.motioncraft.ai.start({kind:'transcribe',assetId:'../private',model:'tiny',language:null})`,
        ),
      );
      await evaluate(`window.motioncraft.ai.start({kind:'detect'})`);
      const job = await evaluate("window.motioncraft.ai.status()");
      await evaluate(`window.motioncraft.ai.cancel('${job.id}')`);
      await wait(
        `(async()=>{const job=await window.motioncraft.ai.status();return ['cancelled','completed'].includes(job?.state);})()`,
      );
      console.log("PASS: invalid IPC inputs rejected; real worker cancellation settles");
      console.log(`Artifacts: ${directory}`);
      finish();
    } catch (error) {
      console.error(await evaluate("document.body.innerText.slice(-1800)").catch(() => ""));
      finish(error);
    }
  });
});
require("./main.cjs");
