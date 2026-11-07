const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { createParser, transcribe } = require("./transcription.cjs");
const { fixture } = require("../core/transcription/fixture.cjs");
const config = {
  pythonPath: "D:\\AI\\python.exe",
  workerPath: "D:\\AI\\motion_craft_ai\\worker.py",
  model: "tiny",
  device: "cpu",
  computeType: "int8",
};
function events(result) {
  return [
    { type: "started" },
    { type: "model_loading", model: "tiny" },
    { type: "model_ready", model: "tiny" },
    ...result.segments.map((segment) => ({ type: "segment", segment })),
    { type: "completed", result },
  ].map((e) => ({ protocolVersion: 1, jobId: result.jobId, ...e }));
}
function child() {
  const c = new EventEmitter();
  c.stdin = new PassThrough();
  c.stdout = new PassThrough();
  c.stderr = new PassThrough();
  c.kill = () => {
    c.killed = true;
  };
  return c;
}
function start() {
  const f = fixture();
  const request = {
    protocolVersion: 1,
    jobId: f.result.jobId,
    action: "transcribe",
    audioPath: f.result.audioPath,
    model: "tiny",
    device: "cpu",
    computeType: "int8",
    options: f.result.execution.options,
  };
  return { f, request };
}
test("NDJSON parser handles split UTF-8, partial lines and rejects malformed/version/truncated events", () => {
  const { result } = fixture();
  result.segments[0].text = "Caf\u00e9";
  const values = events(result),
    bytes = Buffer.from(values.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const parsed = [];
  const parser = createParser((e) => parsed.push(e));
  for (const byte of bytes) parser.push(Buffer.from([byte]));
  parser.finish();
  assert.deepEqual(parsed, values);
  assert.throws(() => createParser(() => {}).push(Buffer.from("{bad}\n")));
  assert.throws(() =>
    createParser(() => {}).push(
      Buffer.from('{"protocolVersion":2,"type":"started","jobId":null}\n'),
    ),
  );
  const partial = createParser(() => {});
  partial.push(Buffer.from("{"));
  assert.throws(() => partial.finish(), /partial/);
});
test("adapter uses shell:false and only commits completed after successful process exit", async () => {
  const { f, request } = start(),
    c = child();
  let options;
  const promise = transcribe(
    config,
    request,
    () => {},
    () => {},
    (python, args, opts) => {
      assert.equal(python, config.pythonPath);
      assert.deepEqual(args, ["-m", "motion_craft_ai.worker"]);
      options = opts;
      return c;
    },
  );
  assert.equal(options.shell, false);
  assert.equal(options.env.PYTHONDONTWRITEBYTECODE, "1");
  c.stdout.write(
    events(f.result)
      .map((e) => JSON.stringify(e))
      .join("\n") + "\n",
  );
  let completed = false;
  promise.then(() => {
    completed = true;
  });
  await Promise.resolve();
  assert.equal(completed, false);
  c.emit("close", 0);
  assert.deepEqual(await promise, f.result);
});
test("spawn errors, crashes, protocol transitions, missing model and cancellation reject without committing", async () => {
  for (const action of ["spawn", "crash", "transition", "cancel", "model", "foreign", "nonzero"]) {
    const { f, request } = start(),
      c = child();
    const promise = transcribe(
      config,
      request,
      () => {},
      () => {},
      () => c,
    );
    if (action === "spawn") c.emit("error", new Error("private path"));
    else if (action === "crash" || action === "cancel")
      c.emit("close", action === "crash" ? 1 : null);
    else if (action === "transition") c.stdout.write(JSON.stringify(events(f.result)[2]) + "\n");
    else if (action === "foreign")
      c.stdout.write(JSON.stringify({ ...events(f.result)[0], jobId: crypto.randomUUID() }) + "\n");
    else if (action === "model")
      c.stdout.write(
        JSON.stringify({
          protocolVersion: 1,
          jobId: request.jobId,
          type: "error",
          code: "model_missing",
          message: "private path",
        }) + "\n",
      );
    else {
      c.stdout.write(
        events(f.result)
          .map((e) => JSON.stringify(e))
          .join("\n") + "\n",
      );
      c.emit("close", 1);
    }
    await assert.rejects(promise, action === "model" ? /not cached/ : undefined);
  }
});
