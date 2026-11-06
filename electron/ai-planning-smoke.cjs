// Optional real qwen3:8b acceptance. Uses isolated profile; never applies a plan.
const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { scenePlanSchema } = require("../core/ai/scene-plan.cjs");
const directory = fs.mkdtempSync(path.join(__dirname, "../.next/ai-planning-"));
app.setPath("userData", directory);
const timer = setTimeout(() => finish(new Error("Real scene planning UI timed out")), 180000);
function finish(error) {
  clearTimeout(timer);
  if (error) console.error(error);
  app.exit(error ? 1 : 0);
}
app.once("browser-window-created", (_event, window) => {
  window.webContents.once("did-finish-load", async () => {
    const evaluate = (source) => window.webContents.executeJavaScript(source, true);
    const wait = async (source) => {
      for (let i = 0; i < 1400; i++) {
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
    const fill = async (label, value) =>
      evaluate(
        `(()=>{const e=document.querySelector('[aria-label="'+${JSON.stringify(label)}+'"]');Object.getOwnPropertyDescriptor(e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
    const exported = async (button) =>
      evaluate(
        `(async()=>{const make=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;let blob;URL.createObjectURL=value=>{blob=value;return make.call(URL,value)};HTMLAnchorElement.prototype.click=()=>{};try{Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(button)}).click()}finally{URL.createObjectURL=make;HTMLAnchorElement.prototype.click=click}return JSON.parse(await blob.text())})()`,
      );
    try {
      await wait("!!window.motioncraft?.ai");
      await wait(`!document.querySelector('[aria-label="Export JSON"]')?.disabled`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const before = await exported("Export JSON");
      await evaluate(`document.querySelector('[aria-label="AI Production"]').click()`);
      await wait(`document.querySelector('[aria-label="Ollama model"]')?.value==='qwen3:8b'`);
      await fill(
        "AI script",
        "Sunlight filters through a forest. A river flows between the trees.",
      );
      await click("Generate scene plan");
      await wait(`!!document.querySelector('[aria-label="AI plan review"]')`);
      const original = scenePlanSchema.parse(await exported("Save structured planning JSON"));
      assert.equal(original.modelId, "qwen3:8b");
      assert.equal(original.timing, "estimated");
      await fill("Visual description 1", "A sunlit river surrounded by trees.");
      await fill("Search keywords 1", "river,trees");
      const edited = scenePlanSchema.parse(await exported("Save structured planning JSON"));
      assert.equal(edited.scenes[0].visualPrompt, "A sunlit river surrounded by trees.");
      assert.deepEqual(edited.scenes[0].searchKeywords, ["river", "trees"]);
      assert.equal(edited.scenes[0].sceneId, original.scenes[0].sceneId);
      await evaluate(
        `document.querySelector('dialog[aria-label="AI Production"]').dispatchEvent(new Event('cancel',{cancelable:true}))`,
      );
      await wait(`!document.querySelector('dialog[aria-label="AI Production"]')`);
      assert.deepEqual(await exported("Export JSON"), before);
      // Verify real IPC cancellation retains the slot until worker exit.
      const job = await evaluate(
        `window.motioncraft.ai.start({kind:'plan',model:'qwen3:8b',input:{kind:'script',text:'A forest beside a river.'},settings:{fps:30,aspectRatio:'16:9',style:'default',minSeconds:2,maxSeconds:12,wordsPerMinute:150,instructions:'',temperature:0}})`,
      );
      await evaluate(`window.motioncraft.ai.cancel(${JSON.stringify(job.id)})`);
      await wait(`window.motioncraft.ai.status().then(job=>job?.state==='cancelled')`);
      assert.deepEqual(await exported("Export JSON"), before);
      console.log(
        "PASS: real Ollama discovery, qwen3:8b generation through UI/IPC, editable validated preview, stable IDs, cancellation and unchanged project.",
      );
      finish();
    } catch (error) {
      finish(error);
    }
  });
});
require("./main.cjs");
