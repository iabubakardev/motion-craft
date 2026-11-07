const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { EventEmitter } = require("node:events"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  { createRequire } = require("node:module");
function setup() {
  const handlers = new Map(),
    frame = { url: "http://localhost:3000/" },
    contents = Object.assign(new EventEmitter(), { id: 1, mainFrame: frame }),
    window = { webContents: contents };
  let launched = 0,
    release = 0,
    resolve;
  const service = {
    analyze: () => {
      launched++;
      return new Promise((r) => (resolve = r));
    },
    mix: () => {
      launched++;
      throw new Error("Unexpected mix");
    },
    release: () => release++,
  };
  const filename = path.join(__dirname, "audio.cjs"),
    req = createRequire(filename),
    m = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    __dirname: path.dirname(filename),
    module: m,
    exports: m.exports,
    require: (name) =>
      name === "electron"
        ? {
            app: { getPath: () => path.join(__dirname, "../../.next/audio-ipc-test") },
            BrowserWindow: { fromWebContents: (s) => (s === contents ? window : null) },
            ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
          }
        : name === "../audio-service.cjs"
          ? { createAudioService: () => service }
          : req(name),
  });
  const id = "00000000-0000-4000-8000-000000000001";
  m.exports.registerAudioIPC({
    listAssets: () => [{ id, type: "audio", status: "ready" }],
    captureBindings: () => [{ id }],
    registerDerived: () => {
      throw new Error("Unexpected register");
    },
  });
  return {
    handlers,
    event: { sender: contents, senderFrame: frame },
    frame,
    contents,
    id,
    get launched() {
      return launched;
    },
    get release() {
      return release;
    },
    complete: (value) => resolve(value),
  };
}
test("audio IPC rejects untrusted origins, paths, extra arguments and malformed projects before work", async () => {
  const c = setup(),
    analyze = c.handlers.get("audio:analyze"),
    mix = c.handlers.get("audio:mix");
  await assert.rejects(analyze(c.event, "C:/private"));
  await assert.rejects(analyze(c.event, c.id, undefined, "extra"));
  await assert.rejects(analyze(c.event, c.id, { start: 5, end: 2 }));
  await assert.rejects(mix(c.event, { path: "C:/media" }));
  await assert.rejects(analyze({ ...c.event, senderFrame: { url: c.frame.url } }, c.id, undefined));
  c.frame.url = "https://untrusted.example/";
  await assert.rejects(analyze(c.event, c.id, undefined));
  assert.equal(c.launched, 0);
});
test("audio IPC rechecks ownership after analysis and releases owned work on navigation", async () => {
  const c = setup(),
    pending = c.handlers.get("audio:analyze")(c.event, c.id, undefined);
  c.contents.emit("did-start-navigation", {}, "", false, true);
  assert.equal(c.release, 1);
  c.frame.url = "https://untrusted.example/";
  c.complete({ version: 1 });
  await assert.rejects(pending, /Unauthorized/);
});
