const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validateConfig, createTranscriptionSettings } = require("./transcription-settings.cjs");
test("configuration accepts native-selected absolute Python/module paths and persists validated defaults", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "motioncraft-config-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const pythonPath = path.join(directory, "python.exe"),
    workerPath = path.join(directory, "motion_craft_ai", "worker.py");
  fs.mkdirSync(path.dirname(workerPath));
  fs.writeFileSync(pythonPath, "");
  fs.writeFileSync(workerPath, "");
  const config = { pythonPath, workerPath, model: "tiny", device: "cpu", computeType: "int8" };
  const settings = createTranscriptionSettings(directory);
  assert.equal(settings.read().available, false);
  assert.deepEqual(settings.save(config).config, config);
  assert.equal(settings.read().available, true);
  for (const patch of [
    { pythonPath: "relative.exe" },
    { workerPath: pythonPath },
    { model: "shell-command" },
    { device: "bogus" },
  ])
    assert.throws(() => validateConfig({ ...config, ...patch }));
  fs.writeFileSync(path.join(directory, "transcription-settings.json"), "{");
  assert.equal(settings.read().available, false);
});

test("local worker defaults recover absent or moved paths without replacing valid settings or corrupt JSON", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "motioncraft-defaults-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, "profile");
  const workerRoot = path.join(root, "tools", "motion-craft-ai");
  const pythonPath = path.join(workerRoot, ".venv", "Scripts", "python.exe");
  const workerPath = path.join(workerRoot, "motion_craft_ai", "worker.py");
  fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
  fs.mkdirSync(path.dirname(workerPath), { recursive: true });
  fs.writeFileSync(pythonPath, "");
  fs.writeFileSync(workerPath, "");
  const settings = createTranscriptionSettings(directory, root);
  const defaults = { pythonPath, workerPath, model: "tiny", device: "cpu", computeType: "int8" };
  assert.deepEqual(settings.read().config, defaults);
  assert.equal(fs.existsSync(directory), false);
  const custom = { ...defaults, model: "small" };
  settings.save(custom);
  assert.deepEqual(settings.read().config, custom);
  const filename = path.join(directory, "transcription-settings.json");
  const stale = JSON.stringify({ ...custom, pythonPath: path.join(root, "old", "python.exe") });
  fs.writeFileSync(filename, stale);
  assert.deepEqual(settings.read().config, defaults);
  assert.equal(fs.readFileSync(filename, "utf8"), stale);
  fs.writeFileSync(filename, "{");
  assert.equal(settings.read().available, false);
  assert.equal(fs.readFileSync(filename, "utf8"), "{");
  fs.unlinkSync(filename);
  assert.equal(createTranscriptionSettings(directory).read().available, false);
  fs.unlinkSync(workerPath);
  assert.equal(settings.read().available, false);
});
