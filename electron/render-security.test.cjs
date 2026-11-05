const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  syncFS = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  vm = require("node:vm");
const { createRequire } = require("node:module");
const http = require("node:http");
const { EventEmitter } = require("node:events");
const { createMediaLibrary } = require("./media-library.cjs");
const { createRenderMediaServer } = require("./render-media-server.cjs");
const { createRenderSample } = require("../rendering/sample.cjs");
test("export media server is loopback/token/asset scoped, streams ranges and rejects changed files", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "motioncraft-render-security-"));
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith("motioncraft-render-security-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "asset.png");
  await fs.writeFile(filename, Buffer.from("0123456789"));
  const library = createMediaLibrary(),
    imported = await library.importFiles([filename]),
    asset = imported.assets[0];
  const server = await createRenderMediaServer(library.captureBindings([asset]));
  t.after(() => server.close());
  const url = server.sources[asset.id];
  assert.equal(new URL(url).hostname, "127.0.0.1");
  let response = await fetch(url, {
    headers: { Range: "bytes=2-5", Origin: "http://localhost:9999" },
  });
  assert.equal(response.status, 206);
  assert.equal(await response.text(), "2345");
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:9999");
  assert.equal((await fetch(url, { method: "HEAD" })).headers.get("content-length"), "10");
  assert.equal((await fetch(url.replace(/\/[a-f0-9]{64}\//, "/wrong-token/"))).status, 404);
  assert.equal(
    (await fetch(url.replace(asset.id, "00000000-0000-4000-8000-000000000999"))).status,
    404,
  );
  assert.equal(
    (await fetch(url, { headers: { Origin: "https://untrusted.example" } })).status,
    403,
  );
  assert.equal(
    await new Promise((resolve) =>
      http.get(url, { headers: { Host: "untrusted.example" } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      }),
    ),
    403,
  );
  assert.equal((await fetch(url, { method: "POST" })).status, 404);
  assert.equal((await fetch(url, { headers: { Range: "bytes=999-1000" } })).status, 416);
  await fs.writeFile(filename, "changed bytes");
  assert.equal((await fetch(url)).status, 410);
});
function setup(showSaveDialog = async () => ({ canceled: true })) {
  const handlers = new Map(),
    frame = { url: "http://localhost:3000/" };
  const contents = Object.assign(new EventEmitter(), { id: 1, mainFrame: frame }),
    window = { webContents: contents };
  const jobs = {
    start: async () => {
      throw new Error("Unexpected worker launch");
    },
    status: () => null,
    cancel: () => null,
    release: () => {},
    dispose: () => {},
    isBusy: () => false,
  };
  const electron = {
    app: { on: () => {} },
    BrowserWindow: { fromWebContents: (sender) => (sender === contents ? window : null) },
    dialog: { showSaveDialog, showMessageBox: async () => ({ response: 0 }) },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
  };
  const filename = require.resolve("./ipc/render.cjs"),
    localRequire = createRequire(filename),
    testModule = { exports: {} };
  vm.runInNewContext(syncFS.readFileSync(filename, "utf8"), {
    require: (name) =>
      name === "electron"
        ? electron
        : name === "../render-jobs.cjs"
          ? { createRenderJobs: () => jobs }
          : localRequire(name),
    module: testModule,
    console,
  });
  testModule.exports.registerRenderIPC({ captureBindings: () => [] });
  return { handlers, event: { sender: contents, senderFrame: frame }, jobs };
}
test("render IPC validates sender/main frame and exact capability tuples before opening output dialogs", async () => {
  let calls = 0;
  const context = setup(async () => {
      calls++;
      return { canceled: true };
    }),
    start = context.handlers.get("render:start"),
    project = createRenderSample();
  await assert.rejects(start(context.event, project, "C:/unauthorized.mp4"));
  await assert.rejects(
    start({ ...context.event, senderFrame: { url: context.event.senderFrame.url } }, project),
  );
  assert.throws(() => context.handlers.get("render:status")({ ...context.event, sender: {} }));
  assert.throws(() => context.handlers.get("render:cancel")(context.event, "../bad-id"));
  assert.throws(() => context.handlers.get("render:status")(context.event, { path: "C:/secret" }));
  assert.equal(calls, 0);
  assert.equal(await start(context.event, project), null);
  assert.equal(calls, 1);
});
test("output dialog completion revalidates navigation and duplicate pending exports are rejected", async () => {
  let resolve;
  const context = setup(() => new Promise((done) => (resolve = done))),
    start = context.handlers.get("render:start"),
    project = createRenderSample();
  const pending = start(context.event, project);
  await assert.rejects(start(context.event, project), /already/);
  context.event.senderFrame.url = "https://untrusted.example/";
  resolve({ canceled: false, filePath: "C:/secret.mp4" });
  await assert.rejects(pending, (error) => !error.message.includes("secret"));
});
