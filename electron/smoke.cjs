// Run against an already running development server. Exercises the real main/preload.
const { app } = require("electron");
const assert = require("node:assert/strict");

const timeout = setTimeout(() => {
  console.error("Electron smoke test timed out");
  app.exit(1);
}, 30000);

app.on("browser-window-created", (_event, window) => {
  window.webContents.once("did-finish-load", async () => {
    try {
      const result = await window.webContents.executeJavaScript(`(async () => ({
        version: await window.motioncraft.getAppVersion(),
        nodeAvailable: typeof require !== 'undefined',
        bridgeKeys: Object.keys(window.motioncraft)
      }))()`);
      assert.equal(result.version, app.getVersion());
      assert.equal(result.nodeAvailable, false);
      assert.deepEqual(result.bridgeKeys, ["getAppVersion", "render", "media", "projects"]);
      const prefs = window.webContents.getLastWebPreferences();
      assert.equal(prefs.contextIsolation, true);
      assert.equal(prefs.sandbox, true);
      assert.equal(prefs.nodeIntegration, false);
      // Let the feature's hydration IPC finish before tearing down its owning frame.
      await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const deadline = Date.now() + 10000;
        function check() {
          const button = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Import media'));
          if (button && !button.disabled) return resolve();
          if (Date.now() > deadline) return reject(new Error('Media session hydration timed out'));
          setTimeout(check, 50);
        }
        check();
      })`);
      console.log(
        "PASS: real preload IPC, app version, bridge surface, renderer isolation and sandbox",
      );
      clearTimeout(timeout);
      app.exit(0);
    } catch (error) {
      console.error(error);
      clearTimeout(timeout);
      app.exit(1);
    }
  });
});

require("./main.cjs");
