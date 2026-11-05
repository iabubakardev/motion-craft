const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createRequire } = require("node:module");
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
function setup() {
  const handlers = new Map(),
    frame = { url: "http://localhost:3000/" },
    contents = Object.assign(new EventEmitter(), { id: 1, mainFrame: frame }),
    window = { webContents: contents };
  let released = 0,
    starts = 0;
  const jobs = {
    start: () => {
      starts++;
      throw new Error("Unexpected launch");
    },
    status: () => null,
    cancel: () => null,
    release: () => {
      released++;
    },
  };
  const electron = {
    app: { once: () => {} },
    BrowserWindow: { fromWebContents: (sender) => (sender === contents ? window : null) },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
  };
  const filename = path.join(__dirname, "ai.cjs"),
    localRequire = createRequire(filename),
    testModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    require: (name) =>
      name === "electron"
        ? electron
        : name === "../ai-jobs.cjs"
          ? { createAIJobs: () => jobs }
          : localRequire(name),
    module: testModule,
    exports: testModule.exports,
  });
  testModule.exports.registerAIIPC({ listAssets: () => [], captureBindings: () => [] });
  return {
    handlers,
    event: { sender: contents, senderFrame: frame },
    contents,
    frame,
    get starts() {
      return starts;
    },
    get released() {
      return released;
    },
  };
}
test("AI IPC rejects untrusted origins, subframes, foreign senders and extra arguments", () => {
  const c = setup();
  const status = c.handlers.get("ai:status");
  assert.equal(status(c.event), null);
  assert.throws(() => status(c.event, "extra"));
  assert.throws(() => status({ ...c.event, senderFrame: { url: c.frame.url } }));
  assert.throws(() => status({ ...c.event, sender: { id: 2 } }));
  c.frame.url = "https://untrusted.example/";
  assert.throws(() => status(c.event));
  assert.equal(c.starts, 0);
});
test("AI IPC accepts only asset IDs and model settings, never paths, URLs or arbitrary commands", () => {
  const c = setup(),
    start = c.handlers.get("ai:start");
  for (const request of [
    { kind: "transcribe", assetId: "C:/private", model: "tiny", language: null },
    { kind: "detect", command: "python --evil" },
    { kind: "plan", url: "https://example.com" },
    {
      kind: "transcribe",
      assetId: "00000000-0000-4000-8000-000000000001",
      model: "../model",
      language: null,
    },
  ])
    assert.throws(() => start(c.event, request));
  assert.throws(
    () =>
      start(c.event, {
        kind: "transcribe",
        assetId: "00000000-0000-4000-8000-000000000001",
        model: "tiny",
        language: null,
      }),
    /MP3 or WAV/,
  );
  assert.equal(c.starts, 0);
});
test("main-frame navigation and renderer destruction release owned jobs", () => {
  const c = setup();
  c.handlers.get("ai:status")(c.event);
  c.contents.emit("did-start-navigation", {}, "http://localhost:3000/", false, true);
  assert.equal(c.released, 1);
  c.contents.emit("destroyed");
  assert.equal(c.released, 2);
});
