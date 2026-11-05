// @ts-check
const { fork, execFile } = require("node:child_process");
const path = require("node:path");
/** Shared supervised-process primitives for render and AI jobs.
 * @param {string} entry */
function launchWorker(entry) {
  /** @type {import('node:child_process').ForkOptions & {windowsHide:boolean}} */
  const options = {
    execPath: process.execPath,
    execArgv: [],
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  };
  return fork(entry, [], options);
}
/** @param {import('node:child_process').ChildProcess} child */
function killTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32")
    execFile(
      path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"),
      ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true },
      () => {},
    );
  else child.kill("SIGKILL");
}
module.exports = { launchWorker, killTree };
