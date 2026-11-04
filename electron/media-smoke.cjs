// Real Electron/React/protocol test; only the native dialog result is stubbed.
const { app, BrowserWindow, dialog } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

let fixtureDirectory;
let browser;
let dialogCalls = 0;
let testWindow;
let originalLayout;
const rendererErrors = [];
const selections = [];
// Reload regression intentionally discards this generated, unsaved test document.
dialog.showMessageBoxSync = () => 1;
dialog.showOpenDialog = async (_window, options) => {
  assert.ok(options.properties.includes("multiSelections"));
  assert.ok(options.filters[0].extensions.includes("mov"));
  assert.ok(options.filters[0].extensions.includes("jpeg"));
  dialogCalls++;
  const selection = selections.shift();
  assert.ok(selection, "Unexpected dialog call");
  return selection;
};

async function finish(error) {
  clearTimeout(timeout);
  if (testWindow && !testWindow.isDestroyed() && originalLayout !== undefined) {
    await testWindow.webContents.executeJavaScript(originalLayout === null ? `localStorage.removeItem('motioncraft.workspace-layout.v1')` : `localStorage.setItem('motioncraft.workspace-layout.v1', ${JSON.stringify(originalLayout)})`).catch(() => {});
  }
  if (browser && !browser.isDestroyed()) browser.destroy();
  if (fixtureDirectory) await fs.rm(fixtureDirectory, { recursive: true, force: true });
  if (error) console.error(error);
  app.exit(error ? 1 : 0);
}
const timeout = setTimeout(() => void finish(new Error("Media smoke test timed out")), 60000);

app.once("browser-window-created", (_event, window) => {
  testWindow = window;
  window.webContents.on("console-message", (event) => {
    if (/hydration|maximum update depth|uncaught|did not match/i.test(event.message || "")) rendererErrors.push(event.message);
  });
  window.webContents.once("did-finish-load", async () => {
    const evaluate = (source) => window.webContents.executeJavaScript(source, true);
    const waitFor = async (source) => {
      for (let attempt = 0; attempt < 160; attempt++) {
        if (await evaluate(source)) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`Timed out: ${source}`);
    };
    const clickImport = () => evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Import media')).click()`);
    const select = (filename) => evaluate(`Array.from(document.querySelectorAll('ul[aria-label="Imported media"] button')).find(b => b.textContent.includes(${JSON.stringify(filename)})).click()`);
    try {
      await waitFor(`!!Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Import media') && !b.disabled)`);
      originalLayout = await evaluate(`localStorage.getItem('motioncraft.workspace-layout.v1')`);
      fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "motioncraft-smoke-"));
      const fixtures = await evaluate(`(async () => {
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
        const context = canvas.getContext('2d');
        function draw() { context.fillStyle = '#292044'; context.fillRect(0,0,320,180); context.fillStyle = '#a78bfa'; context.fillRect(25,25,70,130); context.fillStyle = '#eee'; context.font = '22px sans-serif'; context.fillText('MotionCraft',110,95); }
        draw();
        const png = canvas.toDataURL('image/png').split(',')[1];
        const stream = canvas.captureStream(10);
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
        const chunks = []; recorder.ondataavailable = e => chunks.push(e.data);
        const stopped = new Promise(resolve => recorder.onstop = resolve);
        recorder.start(); const timer = setInterval(draw, 100);
        await new Promise(resolve => setTimeout(resolve, 1100));
        recorder.stop(); await stopped; clearInterval(timer); stream.getTracks().forEach(t => t.stop());
        return { png, webm: Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())) };
      })()`);
      const imagePath = path.join(fixtureDirectory, "Opening.png");
      const audioPath = path.join(fixtureDirectory, "Soundtrack.wav");
      const videoPath = path.join(fixtureDirectory, "Footage.webm");
      const brokenPath = path.join(fixtureDirectory, "Broken.png");
      await fs.writeFile(imagePath, Buffer.from(fixtures.png, "base64"));
      await fs.writeFile(videoPath, Buffer.from(fixtures.webm));
      await fs.writeFile(brokenPath, "not a png");
      const samples = 8000;
      const wav = Buffer.alloc(44 + samples * 2);
      wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
      wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
      wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
      for (let index = 0; index < samples; index++) wav.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 440 / 8000) * 2000), 44 + index * 2);
      await fs.writeFile(audioPath, wav);

      selections.push({ canceled: false, filePaths: [imagePath, audioPath, videoPath, brokenPath, path.join(fixtureDirectory, "missing.mp4"), path.join(fixtureDirectory, "bad.txt")] });
      await clickImport();
      await waitFor(`document.querySelectorAll('ul[aria-label="Imported media"] li').length === 4`);
      await waitFor(`(async () => (await window.motioncraft.media.listAssets()).every(a => a.status !== 'imported'))()`);
      let assets = await evaluate("window.motioncraft.media.listAssets()");
      assert.equal(assets.filter((asset) => asset.status === "ready").length, 3);
      assert.equal(assets.find((asset) => asset.filename === "Broken.png").status, "error");
      assert.equal(assets.find((asset) => asset.type === "image" && asset.status === "ready").width, 320);
      assert.equal(assets.find((asset) => asset.type === "audio").duration, 1);
      assert.ok(!JSON.stringify(assets).includes(fixtureDirectory));
      console.log("PASS: multi-import, decoded metadata, corrupt/unsupported/missing files, path privacy");

      await select("Opening.png");
      await waitFor(`document.querySelector('[aria-label=\"Media preview\"] img')?.naturalWidth === 320`);
      await select("Footage.webm");
      await waitFor(`!!document.querySelector('[aria-label=\"Media preview\"] video')`);
      await evaluate(`(async () => { const v = document.querySelector('[aria-label=\"Media preview\"] video'); v.muted = true; await v.play(); })()`);
      await waitFor(`document.querySelector('[aria-label=\"Media preview\"] video')?.currentTime > 0.1`);
      await select("Soundtrack.wav");
      await waitFor(`!!document.querySelector('[aria-label=\"Media preview\"] audio')`);
      await evaluate(`(async () => { const a = document.querySelector('[aria-label=\"Media preview\"] audio'); a.muted = true; await a.play(); })()`);
      await waitFor(`document.querySelector('[aria-label=\"Media preview\"] audio')?.currentTime > 0.1`);
      console.log("PASS: real image preview and video/audio playback over the custom protocol");

      await evaluate(`Array.from(document.querySelectorAll('nav button')).find(b => b.getAttribute('aria-label') === 'Videos').click()`);
      await waitFor(`document.querySelectorAll('ul[aria-label="Imported media"] li').length === 1`);
      await evaluate(`document.querySelector('button[aria-label="List view"]').click()`);
      assert.equal(await evaluate(`document.querySelector('button[aria-label="List view"]').getAttribute('aria-pressed')`), "true");
      await evaluate(`Array.from(document.querySelectorAll('nav button')).find(b => b.getAttribute('aria-label') === 'All media').click(); const input=document.querySelector('input[type="search"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'OPENING'); input.dispatchEvent(new Event('input', { bubbles:true }));`);
      await waitFor(`document.querySelectorAll('ul[aria-label="Imported media"] li').length === 1 && document.querySelector('ul[aria-label="Imported media"]').textContent.includes('Opening.png')`);
      console.log("PASS: React filename search, type filters, selection and list view");

      selections.push({ canceled: true, filePaths: [] });
      await clickImport();
      await waitFor(`document.body.textContent.includes('Import canceled.')`);
      selections.push({ canceled: false, filePaths: [imagePath, audioPath] });
      await clickImport();
      await waitFor(`document.body.textContent.includes('2 already in this session.')`);
      assets = await evaluate("window.motioncraft.media.listAssets()");
      assert.equal(assets.length, 4);
      await new Promise((resolve) => { window.webContents.once("did-finish-load", resolve); window.webContents.reload(); });
      await waitFor(`document.querySelectorAll('ul[aria-label="Imported media"] li').length === 4`);
      const range = await evaluate(`(async () => { const r=await fetch(${JSON.stringify(assets.find((asset) => asset.type === "audio").url)}, { headers: { Range: 'bytes=0-9' } }); return { status:r.status, length:(await r.arrayBuffer()).byteLength }; })()`);
      assert.deepEqual(range, { status: 206, length: 10 });
      console.log("PASS: cancel, duplicate handling, renderer reload session recovery and HTTP byte ranges");

      // Workspace tabs must retain the same media session and share selection.
      await evaluate(`document.querySelector('#tab-scenes').click()`);
      await waitFor(`!document.querySelector('#scenes-panel').hidden`);
      assert.equal((await evaluate("window.motioncraft.media.listAssets()")).length, 4);
      await evaluate(`document.querySelector('#tab-audio').click()`);
      await waitFor(`document.querySelectorAll('ul[aria-label="Imported media"] li').length === 1`);
      await select("Soundtrack.wav");
      await waitFor(`document.querySelector('[data-testid="inspector-filename"]')?.textContent === 'Soundtrack.wav'`);
      await evaluate(`document.querySelector('#tab-media').click()`);
      await waitFor(`document.querySelectorAll('ul[aria-label="Imported media"] li').length === 4`);
      await select("Footage.webm");
      await waitFor(`!!document.querySelector('[aria-label="Media preview"] video')`);
      await evaluate(`document.activeElement.blur(); window.dispatchEvent(new KeyboardEvent('keydown', { key:' ', code:'Space', bubbles:true, cancelable:true }));`);
      await waitFor(`!document.querySelector('[aria-label="Media preview"] video').paused`);
      await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key:' ', code:'Space', bubbles:true, cancelable:true }));`);
      await waitFor(`document.querySelector('[aria-label="Media preview"] video').paused`);
      await evaluate(`const input=document.querySelector('input[type="search"]'); input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', { key:' ', code:'Space', bubbles:true, cancelable:true })); input.dispatchEvent(new KeyboardEvent('keydown', { key:'o', ctrlKey:true, bubbles:true, cancelable:true }));`);
      assert.equal(await evaluate(`document.querySelector('[aria-label="Media preview"] video').paused`), true);
      assert.equal(dialogCalls, 3);
      await evaluate(`document.activeElement.blur(); window.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true, cancelable:true }));`);
      await waitFor(`!document.querySelector('[data-testid="inspector-filename"]')`);
      selections.push({ canceled: true, filePaths: [] });
      await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key:'o', ctrlKey:true, bubbles:true, cancelable:true }));`);
      await waitFor(`document.body.textContent.includes('Import canceled.')`);
      console.log("PASS: Media/Scenes/Audio tabs, contextual inspector, Space/Escape/Ctrl+O and text-input shortcut protection");

      await evaluate(`document.querySelector('button[aria-label="Reset workspace layout"]').click()`);
      await waitFor(`Number(document.querySelector('[aria-label="Resize media sidebar"]').getAttribute('aria-valuenow')) === 300`);
      const dividerValue = (label) => evaluate(`Number(document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}).getAttribute('aria-valuenow'))`);
      for (const [label, dx, dy] of [["Resize media sidebar", 24, 0], ["Resize properties inspector", -24, 0], ["Resize timeline", 0, -20]]) {
        const before = await dividerValue(label);
        const point = await evaluate(`(() => { const r=document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}).getBoundingClientRect(); return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)}; })()`);
        window.focus();
        window.webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
        window.webContents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount: 1 });
        window.webContents.sendInputEvent({ type: "mouseMove", x: point.x + dx, y: point.y + dy, modifiers: ["leftButtonDown"] });
        window.webContents.sendInputEvent({ type: "mouseUp", x: point.x + dx, y: point.y + dy, button: "left", clickCount: 1 });
        await waitFor(`Number(document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}).getAttribute('aria-valuenow')) > ${before + 5}`);
      }
      await evaluate(`document.querySelector('[aria-label="Resize media sidebar"]').dispatchEvent(new MouseEvent('dblclick', {bubbles:true}));`);
      await waitFor(`Number(document.querySelector('[aria-label="Resize media sidebar"]').getAttribute('aria-valuenow')) === 300`);
      await evaluate(`const h=document.querySelector('[aria-label="Resize media sidebar"]'); h.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight',bubbles:true,cancelable:true}));`);
      await waitFor(`Number(document.querySelector('[aria-label="Resize media sidebar"]').getAttribute('aria-valuenow')) === 310`);
      await waitFor(`JSON.parse(localStorage.getItem('motioncraft.workspace-layout.v1')).left === 310`);
      await new Promise((resolve) => { window.webContents.once("did-finish-load", resolve); window.webContents.reload(); });
      await waitFor(`Number(document.querySelector('[aria-label="Resize media sidebar"]').getAttribute('aria-valuenow')) === 310`);
      assert.deepEqual(Object.keys(await evaluate(`JSON.parse(localStorage.getItem('motioncraft.workspace-layout.v1'))`)).sort(), ["bottom", "left", "right", "version"]);
      window.setSize(1100, 700);
      await waitFor(`document.querySelector('[aria-label="Media preview"]').clientWidth >= 320 && document.documentElement.scrollWidth <= innerWidth + 1`);
      assert.ok(await evaluate(`document.querySelector('.editor-top').clientHeight >= 240`));
      console.log("PASS: pointer resizing all panels, divider keyboard/reset, persisted bounded layout and minimum desktop size");

      await evaluate(`document.querySelector('[aria-label="Timeline playhead"]').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight',bubbles:true,cancelable:true}));`);
      await waitFor(`document.querySelector('[aria-label="Timeline marker time"]').textContent === '1.0 s'`);
      await evaluate(`document.querySelector('button[aria-label="Zoom timeline in"]').click()`);
      await waitFor(`Number(document.querySelector('input[aria-label="Timeline zoom"]').value) === 16`);
      assert.ok(await evaluate(`document.querySelector('.timeline-scroll').scrollWidth > document.querySelector('.timeline-scroll').clientWidth`));
      await evaluate(`document.querySelector('.timeline-scroll').scrollLeft = 120`);
      assert.ok(await evaluate(`document.querySelector('.timeline-scroll').scrollLeft > 0`));
      await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Project settings')).click()`);
      await waitFor(`!!document.querySelector('dialog[open]')`);
      await evaluate(`document.querySelector('dialog input[name="name"]').value='Smoke project'; document.querySelector('dialog form').requestSubmit();`);
      await waitFor(`document.querySelector('[data-testid="project-name"]').textContent === 'Smoke project'`);
      assert.equal(await evaluate(`!document.querySelector('button[aria-label="Undo"]').disabled && document.querySelector('button[aria-label="Redo"]').disabled && Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Export').disabled`), true);
      await select("Opening.png");
      await waitFor(`document.querySelector('[aria-label="Media preview"] img')?.naturalWidth === 320`);
      await evaluate(`document.querySelector('button[aria-label="Fullscreen preview"]').click()`);
      await waitFor(`!!document.fullscreenElement`);
      await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true,cancelable:true}));`);
      await waitFor(`!document.fullscreenElement`);
      assert.deepEqual(rendererErrors, []);
      console.log("PASS: timeline zoom/scroll/marker, session project settings, disabled editing/export and fullscreen/Escape with no hydration errors");

      const preferences = window.webContents.getLastWebPreferences();
      assert.equal(preferences.sandbox, true); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false);
      await select("Opening.png");
      await waitFor(`document.querySelector('[aria-label=\"Media preview\"] img')?.naturalWidth === 320`);
      await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      await fs.mkdir(path.join(__dirname, "../.next"), { recursive: true });
      const capture = await window.webContents.capturePage();
      await fs.writeFile(path.join(__dirname, "../.next/media-library-smoke.png"), capture.resize({ width: 1440 }).toPNG());
      await fs.unlink(imagePath);
      const missingStatus = await evaluate(`fetch(${JSON.stringify(assets.find((asset) => asset.filename === "Opening.png").url)}).then(r=>r.status)`);
      assert.equal(missingStatus, 410);

      browser = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
      browser.webContents.on("console-message", (event) => {
        if (/hydration|maximum update depth|uncaught|did not match/i.test(event.message || "")) rendererErrors.push(event.message);
      });
      await browser.loadURL("http://localhost:3000");
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await browser.webContents.executeJavaScript(`document.body.textContent.includes('Local media import is available in the desktop app.')`)) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(await browser.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Import media')).disabled`), true);
      for (const width of [820, 520]) {
        browser.setContentSize(width, 850);
        for (let attempt = 0; attempt < 50; attempt++) {
          if (await browser.webContents.executeJavaScript(`innerWidth === ${width} && document.documentElement.scrollWidth <= innerWidth + 1`)) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        assert.equal(await browser.webContents.executeJavaScript(`document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector('.preview-monitor').clientHeight >= 300 && getComputedStyle(document.querySelector('.panel-resize-handle')).display === 'none'`), true);
      }
      assert.deepEqual(rendererErrors, []);
      assert.equal(dialogCalls, 4);
      console.log("PASS: missing-file response, browser fallback, responsive 820/520px layouts and unchanged renderer isolation");
      console.log("Native picker interaction still requires a manual desktop check; dialog results were stubbed.");
      await finish();
    } catch (error) { await finish(error); }
  });
});

require("./main.cjs");
