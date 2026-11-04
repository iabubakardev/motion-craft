const DEV_URL = "http://localhost:3000";

function isTrustedURL(value) {
  try {
    const url = new URL(value);
    return url.origin === DEV_URL && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validateVersionRequest(event, webContents, args) {
  if (
    !webContents ||
    event.sender !== webContents ||
    !event.senderFrame ||
    event.senderFrame !== webContents.mainFrame ||
    !isTrustedURL(event.senderFrame.url) ||
    args.length !== 0
  ) {
    throw new Error("Unauthorized app:getVersion request");
  }
}

module.exports = { DEV_URL, isTrustedURL, validateVersionRequest };
