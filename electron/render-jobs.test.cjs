const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ChildProcess } = require("node:child_process");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { createRenderJobs } = require("./render-jobs.cjs");
const { createRenderSample } = require("../rendering/sample.cjs");
async function setup(t, previous) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "motioncraft-job-test-"));
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith("motioncraft-job-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, "out.mp4");
  if (previous) await fs.writeFile(output, previous);
  const child = new ChildProcess();
  let request;
  child.send = (message) => {
    if (!message.cancel) request = message;
    return true;
  };
  const jobs = createRenderJobs(() => child);
  t.after(() => jobs.dispose());
  const job = await jobs.start(
    1,
    { project: createRenderSample(), output, bindings: [] },
    await fs.stat(output).catch(() => null),
  );
  const wait = async (state) => {
    for (let i = 0; i < 100; i++) {
      if (jobs.status(1)?.state === state) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`State not reached: ${state}`);
  };
  return { jobs, child, request, job, output, wait };
}
test("render lifecycle reports real stages, commits once, and terminal jobs ignore late events", async (t) => {
  const c = await setup(t);
  c.child.emit("message", { type: "progress", state: "bundling", progress: 0.5 });
  assert.equal(c.jobs.status(1).progress, 0.5);
  assert.equal(c.jobs.status(1).state, "bundling");
  c.child.emit("message", { type: "progress", state: "rendering", progress: 0.3 });
  assert.equal(c.jobs.status(1).state, "rendering");
  assert.equal(c.jobs.status(2), null);
  await fs.writeFile(c.request.output, "verified new output");
  c.child.emit("message", { type: "done" });
  await c.wait("completed");
  assert.equal(await fs.readFile(c.output, "utf8"), "verified new output");
  assert.equal(c.jobs.status(1).progress, 1);
  c.child.emit("message", { type: "progress", state: "rendering", progress: 0.1 });
  assert.equal(c.jobs.status(1).state, "completed");
  assert.equal(c.jobs.isBusy(), false);
});
test("cancel ignores late progress and preserves previous output while cleaning partial files", async (t) => {
  const c = await setup(t, "previous output");
  await fs.writeFile(c.request.output, "partial");
  assert.equal(c.jobs.cancel(2, c.job.id), null);
  assert.equal(c.jobs.status(1).state, "preparing");
  c.jobs.cancel(1, c.job.id);
  c.child.emit("message", { type: "progress", state: "rendering", progress: 0.9 });
  assert.equal(c.jobs.status(1).state, "cancelling");
  c.child.emit("message", { type: "cancelled" });
  await c.wait("cancelled");
  assert.equal(await fs.readFile(c.output, "utf8"), "previous output");
  await assert.rejects(fs.stat(c.request.output));
});
test("worker failure and unexpected termination are terminal without replacing a prior output", async (t) => {
  const c = await setup(t, "previous output");
  c.child.emit("message", { type: "failed", message: "Media inaccessible" });
  await c.wait("failed");
  assert.equal(c.jobs.status(1).message, "Media inaccessible");
  assert.equal(await fs.readFile(c.output, "utf8"), "previous output");
  const d = await setup(t);
  d.child.emit("exit", 1);
  await d.wait("failed");
  assert.match(d.jobs.status(1).message, /unexpectedly/);
});
test("a destination changed after confirmation is preserved and malformed worker events are ignored", async (t) => {
  const c = await setup(t, "previous output");
  c.child.emit("message", { type: "progress", state: "rendering", progress: 2 });
  assert.equal(c.jobs.status(1).progress, 0);
  await fs.writeFile(c.output, "external changed output");
  await fs.writeFile(c.request.output, "new output");
  c.child.emit("message", { type: "done" });
  await c.wait("failed");
  assert.equal(await fs.readFile(c.output, "utf8"), "external changed output");
});
