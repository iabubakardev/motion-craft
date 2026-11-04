const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createRequire } = require("node:module");

function setup(showOpenDialog) {
  const handlers = new Map();
  const frame = { url: "http://localhost:3000/" };
  const contents = { mainFrame: frame };
  const window = { webContents: contents };
  const electron = {
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    BrowserWindow: { fromWebContents: (sender) => sender === contents ? window : undefined },
    dialog: { showOpenDialog },
  };
  const filename = require.resolve("./media.cjs");
  const localRequire = createRequire(filename);
  const testModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    require: (name) => name === "electron" ? electron : localRequire(name),
    module: testModule, console,
  });
  let imports = 0;
  testModule.exports.registerMediaIPC({
    listAssets: () => [],
    updateMetadata: (_id, metadata) => metadata,
    importFiles: async () => { imports++; return { canceled: false, assets: [], duplicates: 0, errors: [] }; },
  });
  return { handlers, event: { sender: contents, senderFrame: frame }, get imports() { return imports; } };
}

test("media IPC rejects arguments and untrusted frames before opening a dialog", async () => {
  let dialogs = 0;
  const context = setup(async () => { dialogs++; return { canceled: true, filePaths: [] }; });
  const select = context.handlers.get("media:selectFiles");
  await assert.rejects(select(context.event, { path: "C:/secret" }));
  await assert.rejects(select({ ...context.event, senderFrame: { url: context.event.senderFrame.url } }));
  assert.throws(() => context.handlers.get("media:listAssets")({ ...context.event, sender: {} }));
  assert.throws(() => context.handlers.get("media:updateMetadata")(context.event, "bad-id", { status: "ready" }));
  assert.equal(dialogs, 0);
});

test("cancel is a normal result; concurrent requests cannot open overlapping dialogs", async () => {
  let closeDialog;
  const context = setup(() => new Promise((resolve) => { closeDialog = resolve; }));
  const select = context.handlers.get("media:selectFiles");
  const first = select(context.event);
  await assert.rejects(select(context.event), /already open/);
  closeDialog({ canceled: true, filePaths: [] });
  const result = await first;
  assert.equal(result.canceled, true);
  assert.equal(result.assets.length, 0);
  assert.equal(context.imports, 0);
});

test("dialog completion revalidates the frame, and failures cannot leak filesystem paths", async () => {
  const context = setup(async () => {
    context.event.senderFrame.url = "https://untrusted.example/";
    return { canceled: false, filePaths: ["C:/secret.mp4"] };
  });
  await assert.rejects(context.handlers.get("media:selectFiles")(context.event), /Media selection failed/);
  assert.equal(context.imports, 0);
  const failed = setup(async () => { throw new Error("C:/private/path.mp4 access denied"); });
  await assert.rejects(failed.handlers.get("media:selectFiles")(failed.event), (error) => !error.message.includes("private"));
});
