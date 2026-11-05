const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { models, isLocal, describe, localJSON, detectOllama } = require("./ollama.cjs");
const { preparePlan } = require("../core/ai/planning.cjs");
const { run } = require("./ai.cjs");
const settings = {
  fps: 30,
  aspectRatio: "16:9",
  style: "default",
  minSeconds: 2,
  maxSeconds: 12,
  wordsPerMinute: 150,
  instructions: "Trees",
  temperature: 0.2,
};
test("Ollama discovery distinguishes a connected empty installation from an unavailable server", async (t) => {
  const original = global.fetch;
  t.after(() => (global.fetch = original));
  global.fetch = async (url) =>
    Response.json(String(url).endsWith("/api/version") ? { version: "0.40.14" } : { models: [] });
  const runtime = await detectOllama();
  assert.equal(runtime.running, true);
  assert.equal(runtime.version, "0.40.14");
  assert.deepEqual(runtime.models, []);
  assert.match(runtime.message, /no local models/);
  global.fetch = async () => {
    throw new Error("Unavailable");
  };
  assert.equal((await detectOllama()).running, false);
});
test("model-list failures do not hide a reachable Ollama service or its version", async (t) => {
  const original = global.fetch;
  t.after(() => (global.fetch = original));
  global.fetch = async (url) =>
    String(url).endsWith("/api/version")
      ? Response.json({ version: "0.40.14" })
      : new Response("", { status: 500 });
  const runtime = await detectOllama();
  assert.equal(runtime.running, true);
  assert.equal(runtime.version, "0.40.14");
  assert.match(runtime.message, /could not be read/);
});
test("Ollama adapter uses fixed loopback, validates discovery and excludes cloud/remote models", async (t) => {
  const original = global.fetch;
  t.after(() => (global.fetch = original));
  global.fetch = async (url, options) => {
    assert.ok(String(url).startsWith("http://127.0.0.1:11434/"));
    assert.equal(options.redirect, "error");
    return Response.json({
      models: [
        { name: "local:latest" },
        { name: "remote:cloud" },
        { name: "proxy", remote_host: "https://example.com" },
      ],
    });
  };
  assert.deepEqual(await models(), ["local:latest"]);
  assert.equal(isLocal({ name: "proxy", remote_model: "remote" }), false);
});
test("structured planning repairs once, preserves exact timing and validates scene identity", async (t) => {
  const original = global.fetch;
  t.after(() => (global.fetch = original));
  const plan = preparePlan(
    { kind: "script", text: "Sunlight through the forest." },
    settings,
    randomUUID(),
  );
  let chats = 0;
  global.fetch = async (url, options) => {
    if (String(url).endsWith("/api/tags"))
      return Response.json({ models: [{ name: "local:latest" }] });
    if (String(url).endsWith("/api/show")) return Response.json({});
    const body = JSON.parse(options.body);
    assert.equal(body.stream, false);
    assert.equal(body.keep_alive, 0);
    assert.equal(body.format.type, "object");
    chats++;
    return Response.json({
      message: {
        content:
          chats === 1
            ? "not json"
            : JSON.stringify({
                scenes: plan.scenes.map((s) => ({
                  id: s.id,
                  visualDescription: "Forest in sunlight",
                  keywords: ["forest"],
                  assetType: "image",
                  animation: "fade-in",
                })),
              }),
      },
    });
  };
  const described = await describe(plan, "local:latest", settings, () => {});
  assert.equal(chats, 2);
  assert.equal(described.scenes[0].visualDescription, "Forest in sunlight");
  assert.equal(described.scenes[0].end, plan.scenes[0].end);
});
test("missing Ollama, cloud model and malformed/unbounded responses fail without fabricated plans", async (t) => {
  const original = global.fetch;
  t.after(() => (global.fetch = original));
  global.fetch = async () => {
    throw new Error("Offline");
  };
  await assert.rejects(models());
  global.fetch = async () => Response.json({ models: [] });
  const plan = preparePlan({ kind: "script", text: "Trees" }, settings, randomUUID());
  await assert.rejects(
    describe(plan, "missing", settings, () => {}),
    /local Ollama model/,
  );
  global.fetch = async () => Response.json({ models: [{ name: "local" }] });
  await assert.rejects(
    describe(plan, "local", settings, () => {}),
    /two attempts/,
  );
  global.fetch = async () => new Response("x".repeat(1024 * 1024 + 1));
  await assert.rejects(localJSON("/api/tags"), /1 MB/);
});
test("missing audio is rejected before spawning transcription", async () => {
  await assert.rejects(
    run({
      id: randomUUID(),
      request: { kind: "transcribe", assetId: randomUUID(), model: "tiny-en", language: null },
      binding: null,
    }),
    /Import\/relink/,
  );
});
