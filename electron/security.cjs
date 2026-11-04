const DEV_URL = "http://localhost:3000";

function isTrustedURL(value) {
  try {
    const url = new URL(value);
    return url.origin === DEV_URL && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validateRequest(event, webContents) {
  if (
    !webContents ||
    event.sender !== webContents ||
    !event.senderFrame ||
    event.senderFrame !== webContents.mainFrame ||
    !isTrustedURL(event.senderFrame.url)
  ) {
    throw new Error("Unauthorized IPC request");
  }
}

function validateVersionRequest(event, webContents, args) {
  validateRequest(event, webContents);
  if (args.length !== 0) throw new Error("Unexpected app:getVersion arguments");
}

function canUseFullscreen(permission, windowURL, details) {
  return permission === "fullscreen" && details?.isMainFrame === true &&
    isTrustedURL(windowURL) && isTrustedURL(details.requestingUrl);
}

module.exports = { DEV_URL, isTrustedURL, validateRequest, validateVersionRequest, canUseFullscreen };
