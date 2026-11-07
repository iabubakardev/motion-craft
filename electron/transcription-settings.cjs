// @ts-check
const fs = require("node:fs");
const path = require("node:path");
const { configSchema } = require("../core/transcription/schema.cjs");
/** @param {unknown} raw */
function validateConfig(raw) {
  const config = configSchema.parse(raw);
  if (
    !path.isAbsolute(config.pythonPath) ||
    !path.isAbsolute(config.workerPath) ||
    !fs.statSync(config.pythonPath).isFile() ||
    !fs.statSync(config.workerPath).isFile() ||
    path.basename(config.workerPath) !== "worker.py" ||
    path.basename(path.dirname(config.workerPath)) !== "motion_craft_ai"
  )
    throw new Error(
      "Choose an absolute Python executable and motion_craft_ai/worker.py entrypoint.",
    );
  if (
    process.platform === "win32" &&
    !/^python(?:w)?\.exe$/i.test(path.basename(config.pythonPath))
  )
    throw new Error("Select a Python interpreter executable.");
  return config;
}
/** @param {string} directory @param {string|null} [applicationRoot] */
function createTranscriptionSettings(directory, applicationRoot = null) {
  const filename = path.join(directory, "transcription-settings.json");
  const defaults = () => {
    if (!applicationRoot) return null;
    const root = path.join(applicationRoot, "tools", "motion-craft-ai");
    try {
      return validateConfig({
        pythonPath: path.join(root, ".venv", "Scripts", "python.exe"),
        workerPath: path.join(root, "motion_craft_ai", "worker.py"),
        model: "tiny",
        device: "cpu",
        computeType: "int8",
      });
    } catch {
      return null;
    }
  };
  const read = () => {
    try {
      const config = validateConfig(JSON.parse(fs.readFileSync(filename, "utf8")));
      return {
        config,
        available: true,
        message:
          "External worker configured. Cached model availability is checked when transcription starts.",
      };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        const config = defaults();
        if (config)
          return {
            config,
            available: true,
            message:
              "Using the local tools/motion-craft-ai worker (tiny / CPU / int8). Cached models and dependencies are checked at start. Save transcription defaults to keep custom preferences.",
          };
        return {
          config: null,
          available: false,
          message: "Configure a Python interpreter and external AI worker entrypoint.",
        };
      }
      return {
        config: null,
        available: false,
        message:
          "Worker configuration is invalid or unavailable. Select the interpreter and worker again.",
      };
    }
  };
  /** @param {unknown} raw */
  const save = (raw) => {
    const config = validateConfig(raw);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(filename + ".tmp", JSON.stringify(config));
    fs.renameSync(filename + ".tmp", filename);
    return read();
  };
  return { read, save };
}
module.exports = { validateConfig, createTranscriptionSettings };
