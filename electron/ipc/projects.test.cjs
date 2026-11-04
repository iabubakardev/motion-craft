const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { createRequire } = require("node:module");
const { createProject } = require("../../core/project/operations.cjs");

function setup() {
  const handlers = new Map();
  const contents = new EventEmitter(); contents.id = 1; contents.mainFrame = { url: "http://localhost:3000/" };
  const window = { webContents: contents };
  const selections = []; const saves = []; const written = [];
  const project = createProject();
  const store = { read: async () => ({ success: true, project }), resolve: async () => ({ assets: [], missingAssetIds: [] }), save: async (filename, value) => written.push({ filename, value }) };
  const electron = {
    app: { getPath: () => process.cwd() }, BrowserWindow: { fromWebContents: (sender) => sender === contents ? window : null },
    ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) },
    dialog: { showOpenDialog: async () => selections.shift() || { canceled: true, filePaths: [] }, showSaveDialog: async () => saves.shift() || { canceled: true }, showMessageBox: async () => ({ response: 0 }) },
  };
  const filename = require.resolve("./projects.cjs"); const localRequire = createRequire(filename); const testModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), { module: testModule, console, require: (name) => name === "electron" ? electron : name === "../project-store.cjs" ? { createProjectStore: () => store } : localRequire(name) });
  testModule.exports.registerProjectIPC({ relinkAsset: () => { throw new Error("Should not relink without native selection"); } });
  const event = { sender: contents, senderFrame: contents.mainFrame };
  return { call: (channel, ...args) => handlers.get(channel)(event, ...args), handlers, event, contents, selections, saves, written, project };
}

test("project IPC rejects paths/invalid projects and untrusted frames", async () => {
  const context = setup();
  await assert.rejects(context.call("projects:open", { path: "C:/private.json" }));
  await assert.rejects(context.call("projects:save", { ...context.project, path: "C:/private" }, false));
  await assert.rejects(context.call("projects:save", { ...context.project, schemaVersion: 2 }, false));
  await assert.rejects(context.handlers.get("projects:open")({ ...context.event, senderFrame: { url: "http://localhost:3000/" } }));
  assert.equal(context.written.length, 0);
});

test("open is staged until activation; cancel cannot change the current save destination", async () => {
  const context = setup();
  context.selections.push({ canceled: false, filePaths: ["C:/test/first.motioncraft.json"] });
  const candidate = await context.call("projects:open");
  assert.equal(candidate.status, "ready");
  assert.equal(candidate.filename, "first.motioncraft.json");
  assert.equal(JSON.stringify(candidate).includes("C:/test"), false);
  assert.equal((await context.call("projects:save", context.project, false)).status, "canceled");
  await assert.rejects(context.call("projects:activate", { ...context.project, name: "Changed before confirmation" }, candidate.candidateId));
  await context.call("projects:activate", candidate.project, candidate.candidateId);
  context.selections.push({ canceled: true, filePaths: [] });
  assert.equal((await context.call("projects:open")).status, "canceled");
  await context.call("projects:save", context.project, false);
  assert.equal(context.written[0].filename, "C:/test/first.motioncraft.json");
  context.contents.emit("did-finish-load");
  assert.equal((await context.call("projects:save", context.project, false)).status, "canceled");
  assert.equal(context.written.length, 1);
});

test("new/import activation clears destination; canceled save never writes", async () => {
  const context = setup();
  context.saves.push({ canceled: false, filePath: "C:/test/selected.motioncraft.json" });
  assert.equal((await context.call("projects:save", context.project, false)).status, "saved");
  await context.call("projects:activate", context.project, null);
  assert.equal((await context.call("projects:save", context.project, false)).status, "canceled");
  assert.equal(context.written.length, 1);
});
