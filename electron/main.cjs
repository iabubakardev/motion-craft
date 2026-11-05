const { app, BrowserWindow, ipcMain, protocol, dialog } = require("electron");
const path = require("node:path");
const {
  DEV_URL,
  isTrustedURL,
  validateVersionRequest,
  canUseFullscreen,
} = require("./security.cjs");
const { createMediaLibrary } = require("./media-library.cjs");
const { registerMediaIPC } = require("./ipc/media.cjs");
const { registerRenderIPC } = require("./ipc/render.cjs");
const { registerProjectIPC } = require("./ipc/projects.cjs");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "motioncraft-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const isDev = !app.isPackaged;

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#101014",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  for (const eventName of ["will-navigate", "will-redirect"]) {
    mainWindow.webContents.on(eventName, (event, url) => {
      if (!isTrustedURL(url)) event.preventDefault();
    });
  }
  mainWindow.webContents.on("will-frame-navigate", (event) => {
    if (!isTrustedURL(event.url)) event.preventDefault();
  });
  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
  mainWindow.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "warning",
      title: "Unsaved project changes",
      message: "Discard unsaved project changes?",
      detail: "Save your MotionCraft project before closing or reloading to keep these edits.",
      buttons: ["Keep editing", "Discard changes"],
      defaultId: 0,
      cancelId: 0,
    });
    if (choice === 1) event.preventDefault();
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL).catch((error) => {
      console.error("Failed to load the development app:", error);
      app.quit();
    });
  } else {
    // Production loading will be configured during packaging.
    throw new Error("Production Electron loading is not configured yet.");
  }
}

app
  .whenReady()
  .then(() => {
    const { session } = require("electron");
    session.defaultSession.setPermissionRequestHandler(
      (contents, permission, callback, details) => {
        callback(
          !!BrowserWindow.fromWebContents(contents) &&
            canUseFullscreen(permission, contents.getURL(), details),
        );
      },
    );
    session.defaultSession.setPermissionCheckHandler(
      (contents, permission, requestingOrigin, details) => {
        return (
          !!contents &&
          !!BrowserWindow.fromWebContents(contents) &&
          canUseFullscreen(permission, contents.getURL(), {
            ...details,
            requestingUrl: details.requestingUrl || requestingOrigin,
          })
        );
      },
    );
    const mediaLibrary = createMediaLibrary();
    protocol.handle("motioncraft-media", (request) => mediaLibrary.respond(request));
    registerMediaIPC(mediaLibrary);
    registerProjectIPC(mediaLibrary);
    registerRenderIPC(mediaLibrary);
    ipcMain.handle("app:getVersion", (event, ...args) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      validateVersionRequest(event, window?.webContents, args);
      return app.getVersion();
    });

    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  })
  .catch((error) => {
    console.error("Electron startup failed:", error);
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
