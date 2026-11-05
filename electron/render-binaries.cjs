// @ts-check
const path = require("node:path");
const fs = require("node:fs");
const { execFile } = require("node:child_process");
/** Pinned Remotion supplies these binaries; never rely on a developer's PATH. */
function binary(name = "ffprobe") {
  if (process.platform !== "win32" || process.arch !== "x64")
    throw new Error("This desktop render binary adapter currently supports Windows x64.");
  const filename = path.join(
    path.dirname(require.resolve("@remotion/compositor-win32-x64-msvc/package.json")),
    `${name}.exe`,
  );
  if (!fs.existsSync(filename))
    throw new Error("Remotion media binaries are missing. Reinstall application dependencies.");
  return filename;
}
/** @param {string} filename @returns {Promise<unknown>} */
function probe(filename) {
  return new Promise((resolve, reject) =>
    execFile(
      binary(),
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", filename],
      { windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) reject(new Error("Output inspection failed."));
        else {
          try {
            resolve(JSON.parse(stdout));
          } catch {
            reject(new Error("Invalid probe response."));
          }
        }
      },
    ),
  );
}
module.exports = { binary, probe };
