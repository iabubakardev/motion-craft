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
    assert.ok(String(url).endsWith("/api/generate"));
    assert.equal(body.think, false);
    assert.equal(body.keep_alive, 0);
    assert.equal(body.format.type, "object");
    chats++;
    return Response.json({
      done: true,
      response:
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
const { createOllamaProvider, localEndpoint } = require("./ollama.cjs");
test("endpoint configuration accepts only loopback origins", () => {
  assert.equal(localEndpoint("http://127.0.0.1:11435"), "http://127.0.0.1:11435");
  for (const value of [
    "https://example.com",
    "http://192.168.1.1",
    "http://localhost/path",
    "http://user:pass@localhost",
    "http://localhost?query=1",
  ])
    assert.throws(() => localEndpoint(value));
});
test("provider cancellation aborts the active HTTP request and never retries inference", async (t) => {
  const original = global.fetch;
  t.after(() => {
    global.fetch = original;
  });
  const provider = createOllamaProvider();
  let generated = 0;
  global.fetch = async (url, options) => {
    if (String(url).endsWith("/api/tags")) return Response.json({ models: [{ name: "qwen3:8b" }] });
    if (String(url).endsWith("/api/show")) return Response.json({});
    generated++;
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      queueMicrotask(() => provider.cancel());
    });
  };
  await assert.rejects(
    provider.generateStructured(
      preparePlan({ kind: "script", text: "Forest sunlight" }, settings, randomUUID()),
      "qwen3:8b",
      settings,
      () => {},
    ),
    { name: "AbortError" },
  );
  assert.equal(generated, 1);
});
test("external AbortSignal and discovery cancellation propagate", async (t) => {
  const original = global.fetch;
  t.after(() => {
    global.fetch = original;
  });
  global.fetch = async (_url, options) => {
    options.signal.throwIfAborted();
    throw new Error("offline");
  };
  const signal = AbortSignal.abort();
  await assert.rejects(createOllamaProvider().healthCheck(signal), { name: "AbortError" });
  await assert.rejects(createOllamaProvider().listModels(signal), { name: "AbortError" });
});
test("timeouts and missing-model/resource HTTP failures are actionable", async (t) => {
  const original = global.fetch;
  t.after(() => {
    global.fetch = original;
  });
  for (const [status, message] of [
    [404, /model is missing/],
    [500, /RAM\/VRAM/],
  ]) {
    global.fetch = async () => new Response("", { status });
    await assert.rejects(localJSON("/api/generate"), message);
  }
  t.mock.method(AbortSignal, "timeout", () =>
    AbortSignal.abort(new DOMException("timeout", "TimeoutError")),
  );
  global.fetch = async (_url, options) => {
    options.signal.throwIfAborted();
    return Response.json({});
  };
  await assert.rejects(localJSON("/api/generate"), /timed out/);
});
test("invalid model JSON, schema, preset and scene identity fail after bounded repair", async (t) => {
  const original = global.fetch;
  t.after(() => {
    global.fetch = original;
  });
  const plan = preparePlan({ kind: "script", text: "Forest sunlight" }, settings, randomUUID());
  for (const response of [
    "not json",
    JSON.stringify({ scenes: [] }),
    JSON.stringify({
      scenes: [
        {
          id: plan.scenes[0].id,
          visualDescription: "Trees",
          keywords: ["forest"],
          assetType: "image",
          animation: "execute-code",
        },
      ],
    }),
  ]) {
    let calls = 0;
    global.fetch = async (url) => {
      if (String(url).endsWith("/api/tags"))
        return Response.json({ models: [{ name: "qwen3:8b" }] });
      if (String(url).endsWith("/api/show")) return Response.json({});
      calls++;
      return Response.json({ done: true, response });
    };
    await assert.rejects(
      describe(plan, "qwen3:8b", settings, () => {}),
      /two attempts/,
    );
    assert.equal(calls, 2);
  }
});
