const { app } = require("electron"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
app.setPath("userData", fs.mkdtempSync(path.join(__dirname, "../.next/layout-smoke-")));
const timer = setTimeout(() => app.exit(1), 30000);
app.once("browser-window-created", (_, w) =>
  w.webContents.once("did-finish-load", async () => {
    try {
      for (const [width, height, zoom] of [
        [1920, 1000, 1],
        [1280, 720, 1],
        [1100, 640, 1],
        [1920, 1000, 1.5],
      ]) {
        w.setContentSize(width, height);
        w.webContents.setZoomFactor(zoom);
        await new Promise((r) => setTimeout(r, 600));
        const result = await w.webContents.executeJavaScript(
          `(()=>{const root=document.documentElement,footer=document.querySelector('.editor-statusbar').getBoundingClientRect();return {width:innerWidth,height:innerHeight,scrollHeight:root.scrollHeight,scrollWidth:root.scrollWidth,footer:footer.bottom}})()`,
        );
        assert.ok(result.scrollHeight <= result.height + 1, JSON.stringify(result));
        assert.ok(result.scrollWidth <= result.width + 1, JSON.stringify(result));
        assert.ok(Math.abs(result.footer - result.height) <= 1, JSON.stringify(result));
      }
      console.log(
        "PASS: desktop viewport and zoom sizes have no outer scroll or gap below the footer.",
      );
      clearTimeout(timer);
      app.exit(0);
    } catch (e) {
      console.error(e);
      clearTimeout(timer);
      app.exit(1);
    }
  }),
);
require("./main.cjs");
