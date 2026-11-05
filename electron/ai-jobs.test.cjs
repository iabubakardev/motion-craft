const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ChildProcess } = require("node:child_process");
const { createAIJobs } = require("./ai-jobs.cjs");
function setup(t) {
  const child = new ChildProcess();
  child.send = () => true;
  const jobs = createAIJobs(() => child);
  t.after(() => {
    child.emit("exit", 0);
    jobs.release(1);
  });
  return { child, jobs, job: jobs.start(1, { kind: "detect" }, null) };
}
const runtime = {
  kind: "runtime",
  runtime: {
    ollama: { running: true, models: [], message: "Connected" },
    whisper: {
      python: true,
      available: false,
      models: [],
      device: "cpu",
      message: "Not installed",
    },
  },
};
test("AI timeout terminates the task with a classified failure", (t) => {
  const originalSet = global.setTimeout,
    originalClear = global.clearTimeout;
  let expire;
  global.setTimeout = (callback) => {
    expire = callback;
    return {};
  };
  global.clearTimeout = () => {};
  t.after(() => {
    global.setTimeout = originalSet;
    global.clearTimeout = originalClear;
  });
  const { jobs } = setup(t);
  expire();
  assert.equal(jobs.status(1).state, "failed");
  assert.equal(jobs.status(1).error, "timeout");
});
test("AI jobs isolate owners, report real stages and reject conflicts and wrong result types", (t) => {
  const { child, jobs } = setup(t);
  assert.equal(jobs.status(2), null);
  assert.throws(() => jobs.start(2, { kind: "detect" }, null), /in progress/);
  child.emit("message", {
    type: "progress",
    state: "running",
    stage: "Detecting local runtime",
    progress: null,
  });
  assert.equal(jobs.status(1).progress, null);
  child.emit("message", { type: "done", result: runtime });
  assert.equal(jobs.status(1).state, "completed");
  assert.deepEqual(jobs.status(1).result, runtime);
  child.emit("message", { type: "error", code: "unavailable", message: "late" });
  assert.equal(jobs.status(1).state, "completed");
});
test("AI cancellation ignores late output and keeps the slot until actual exit", (t) => {
  const { child, jobs, job } = setup(t);
  assert.equal(jobs.cancel(2, job.id), null);
  jobs.cancel(1, job.id);
  assert.equal(jobs.status(1).state, "cancelling");
  assert.equal(jobs.isBusy(), true);
  child.emit("message", { type: "done", result: runtime });
  assert.equal(jobs.status(1).result, null);
  child.emit("exit", 0);
  assert.equal(jobs.status(1).state, "cancelled");
  assert.equal(jobs.isBusy(), false);
});
test("malformed messages, worker failures and owner release cannot apply a result", (t) => {
  const { child, jobs } = setup(t);
  child.emit("message", { type: "done", result: { path: "private" } });
  assert.equal(jobs.status(1).state, "failed");
  assert.equal(jobs.status(1).error, "invalid-output");
  jobs.release(1);
  assert.equal(jobs.status(1), null);
});
test("AI worker exit is actionable and invalid requests never launch", (t) => {
  const { child, jobs } = setup(t);
  child.emit("exit", 1);
  assert.equal(jobs.status(1).error, "worker-failed");
  assert.throws(() =>
    jobs.start(1, { kind: "transcribe", assetId: "C:/secret", model: "../model" }, null),
  );
});
