// @ts-check
const { ensureBrowser } = require("@remotion/renderer");
const { binary } = require("../electron/render-binaries.cjs");
async function prepare() {
  binary("ffmpeg");
  binary("ffprobe");
  const browser = await ensureBrowser();
  console.log(`Rendering browser: ${browser.type}. Local FFmpeg/FFprobe binaries found.`);
}
prepare().catch(() => {
  console.error(
    "Could not prepare rendering. Check the network for the initial browser download and reinstall missing platform packages.",
  );
  process.exitCode = 1;
});
