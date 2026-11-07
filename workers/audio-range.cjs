// @ts-check
const { spawn } = require("node:child_process"),
  fs = require("node:fs/promises"),
  sync = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { binary } = require("../electron/render-binaries.cjs");
/** @param {string} source @param {number} start @param {number} end @param {(child:import('node:child_process').ChildProcess)=>void} own */
async function prepareAudioRange(source, start, end, own) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "motioncraft-range-")),
    filename = path.join(directory, "audio.wav");
  const cleanup = () => {
    if (
      path.dirname(directory) === os.tmpdir() &&
      path.basename(directory).startsWith("motioncraft-range-")
    )
      try {
        sync.rmSync(directory, { recursive: true, force: true });
      } catch {}
  };
  process.once("exit", cleanup);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(
        binary("ffmpeg"),
        [
          "-v",
          "error",
          "-ss",
          String(start),
          "-i",
          source,
          "-t",
          String(end - start),
          "-vn",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-c:a",
          "pcm_s16le",
          "-y",
          filename,
        ],
        { windowsHide: true, shell: false, stdio: "ignore" },
      );
      own(child);
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("Preparing the selected source range timed out."));
      }, 120000);
      child.once("error", () => {
        clearTimeout(timer);
        reject(new Error("Could not start local audio decoding."));
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(null);
        else reject(new Error("The selected media has no decodable audio stream."));
      });
    });
    return {
      filename,
      cleanup: () => {
        process.removeListener("exit", cleanup);
        cleanup();
      },
    };
  } catch (error) {
    process.removeListener("exit", cleanup);
    cleanup();
    throw error;
  }
}
module.exports = { prepareAudioRange };
