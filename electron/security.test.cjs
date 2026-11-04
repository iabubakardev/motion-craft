const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isTrustedURL, validateVersionRequest } = require("./security.cjs");

test("navigation accepts only the development origin", () => {
  assert.equal(isTrustedURL("http://localhost:3000/?test=1"), true);
  for (const url of ["https://localhost:3000", "http://localhost:3001", "http://localhost:3000.evil.com", "http://user@localhost:3000", "file:///tmp/test", "javascript:alert(1)", "invalid"]) {
    assert.equal(isTrustedURL(url), false, url);
  }
});

test("version IPC requires the owning main frame and no arguments", () => {
  const mainFrame = { url: "http://localhost:3000/" };
  const contents = { mainFrame };
  const event = { sender: contents, senderFrame: mainFrame };
  assert.doesNotThrow(() => validateVersionRequest(event, contents, []));
  for (const invalid of [
    { ...event, sender: {} },
    { ...event, senderFrame: { url: mainFrame.url } },
    { ...event, senderFrame: null },
  ]) assert.throws(() => validateVersionRequest(invalid, contents, []));
  assert.throws(() => validateVersionRequest(event, undefined, []));
  assert.throws(() => validateVersionRequest(event, contents, ["unexpected"]));
  mainFrame.url = "https://example.com/";
  assert.throws(() => validateVersionRequest(event, contents, []));
});
