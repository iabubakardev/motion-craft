const { BrowserWindow, dialog, ipcMain } = require("electron");
const { z } = require("zod");
const { validateRequest } = require("../security.cjs");
const { MEDIA_EXTENSIONS } = require("../media-library.cjs");
const { assetIdSchema, mediaMetadataSchema, importResultSchema } = require("../../core/media/schema.cjs");

function registerMediaIPC(library) {
  let selecting = false;
  const emptyArgs = z.tuple([]);
  const check = (event, args, schema = emptyArgs) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    validateRequest(event, window?.webContents);
    schema.parse(args);
    return window;
  };
  ipcMain.handle("media:listAssets", (event, ...args) => {
    check(event, args);
    return library.listAssets();
  });
  ipcMain.handle("media:updateMetadata", (event, ...args) => {
    check(event, args, z.tuple([assetIdSchema, mediaMetadataSchema]));
    return library.updateMetadata(args[0], args[1]);
  });
  ipcMain.handle("media:selectFiles", async (event, ...args) => {
    const window = check(event, args);
    if (selecting) throw new Error("A media selection is already open.");
    selecting = true;
    try {
      const selection = await dialog.showOpenDialog(window, {
        title: "Import media", buttonLabel: "Import media",
        properties: ["openFile", "multiSelections", "dontAddToRecent"],
        filters: [{ name: "Supported media", extensions: MEDIA_EXTENSIONS }],
      });
      if (selection.canceled) return importResultSchema.parse({ canceled: true, assets: [], duplicates: 0, errors: [] });
      check(event, args); // The originating frame must still be trusted after the dialog closes.
      return await library.importFiles(selection.filePaths);
    } catch (error) {
      console.error("Media selection failed:", error.name);
      throw new Error("Media selection failed. Please try again.");
    } finally {
      selecting = false;
    }
  });
}

module.exports = { registerMediaIPC };
