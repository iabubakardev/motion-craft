// @ts-check
const { z } = require("zod");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { operationSchema, entrySchema, resultSchema } = require("../core/assets/index-schema.cjs");
const { mediaAssetSchema } = require("../core/media/schema.cjs");
const { projectAssetSchema } = require("../core/project/schema.cjs");
const { rank, sampleTimes } = require("../core/assets/search.cjs");
const { readIndex, writeIndex, fingerprint, textHash } = require("../electron/asset-index.cjs");
const { binary } = require("../electron/render-binaries.cjs");
const provider = require("./asset-provider.cjs");
const inputSafety=["-protocol_whitelist","file,pipe","-format_whitelist","mov,matroska,webm,png_pipe,jpeg_pipe,webp_pipe,image2,image2pipe"];
const contextSchema = z
  .object({
    directory: z.string().min(1),
    bindings: z
      .array(
        z
          .object({
            id: z.uuid(),
            originalPath: z.string().min(1),
            size: z.number(),
            modifiedAt: z.number(),
            ino: z.number(),
            asset: mediaAssetSchema,
          })
          .strict(),
      )
      .max(512),
  })
  .strict();
/** Decode a bounded thumbnail, never every video frame. @param {string} filename @param {number|null} at */
async function frame(filename, at) {
  const result = await promisify(execFile)(
    binary("ffmpeg"),
    [
      "-v",
      "error",
      ...(at !== null ? ["-ss", String(at)] : []),
      ...inputSafety,
      "-i",
      filename,
      "-frames:v",
      "1",
      "-vf",
      "scale=768:768:force_original_aspect_ratio=decrease",
      "-f",
      "image2pipe",
      "-vcodec",
      "png",
      "pipe:1",
    ],
    { windowsHide: true, encoding: "buffer", timeout: 60000, maxBuffer: 4 * 1024 * 1024 },
  );
  if (!result.stdout.length) throw new Error("A representative frame could not be decoded.");
  return result.stdout.toString("base64");
}
/** @param {string} filename */
async function inspectVideo(filename){const inspected=await promisify(execFile)(binary("ffprobe"),["-v","error",...inputSafety,"-show_format","-of","json",filename],{windowsHide:true,timeout:30000,maxBuffer:1024*1024});return JSON.parse(inspected.stdout);}
/** @param {unknown} raw @param {unknown} rawContext @param {(stage:string,progress:number|null)=>void} progress @param {typeof provider} [adapter] @param {typeof frame} [decode] @param {typeof inspectVideo} [inspect] */
async function runAssets(raw, rawContext, progress, adapter = provider,decode=frame,inspect=inspectVideo) {
  const operation = operationSchema.parse(raw),
    context = contextSchema.parse(rawContext);
  if (operation.action === "models")
    return resultSchema.parse({
      kind: "assets",
      entries: [],
      matches: [],
      models: await adapter.discover(),
      message:
        "Only locally installed models with advertised vision/embedding capabilities are listed.",
    });
  const catalog = await readIndex(context.directory),
    requested = new Set(operation.assetIds);
  const bindings = context.bindings.filter((b) => requested.has(b.id));
  if (bindings.length !== operation.assetIds.length)
    throw new Error("Import/relink every requested visual asset before indexing.");
  const fingerprints = new Map();
  for (const binding of bindings) fingerprints.set(binding.id, await fingerprint(binding));
  const valid = catalog.entries.filter(
    (entry) =>
      requested.has(entry.asset.id) && fingerprints.get(entry.asset.id) === entry.fingerprint,
  );
  let message = "Index loaded. Unindexed or stale assets have no visual description.";
  if (operation.action === "analyze") {
    const model = (await adapter.discover()).find((m) => m.name === operation.model && m.vision);
    if (!model)
      throw new Error(
        "Select an installed local model advertising vision capability. No model was downloaded.",
      );
    for (const [i, binding] of bindings.entries()) {
      progress(`Analyzing ${i + 1} of ${bindings.length}`, i / bindings.length);
      const old = valid.find((e) => e.asset.id === binding.id);
      if (
        old &&
        !operation.force &&
        (old.origin === "manual" ||
          (old.vision?.name === model.name && old.vision.digest === model.digest))
      )
        continue;
      if (!["image", "video"].includes(binding.asset.type))
        throw new Error("Only images and videos support visual analysis.");
      let times = [0];
      if (binding.asset.type === "video") {
        const metadata = z
          .object({ format: z.object({ duration: z.coerce.number().positive().max(86400) }) })
          .parse(await inspect(binding.originalPath));
        times = sampleTimes(metadata.format.duration);
      }
      const frames = [];
      for (const at of times) {
        const image = await frame(binding.originalPath, binding.asset.type === "video" ? at : null);
        const observation = await adapter.observe(model, [image]);
        frames.push({ at, observation });
      }
      const tags = [
        ...new Set(
          frames.flatMap((f) => [
            ...f.observation.tags,
            ...f.observation.subjects,
            ...f.observation.actions,
            ...f.observation.settings,
          ]),
        ),
      ].slice(0, 40);
      const { id, filename, type, mimeType, size, importedAt, duration, width, height } =
        binding.asset;
      const asset = projectAssetSchema.parse({
        id,
        filename,
        type,
        mimeType,
        size,
        importedAt,
        ...(duration ? { duration } : {}),
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
      });
      const entry = entrySchema.parse({
        asset,
        fingerprint: fingerprints.get(id),
        description: frames
          .map(
            (f) =>
              `${binding.asset.type === "video" ? `[Sample ${f.at.toFixed(3)}s] ` : ""}${f.observation.description}`,
          )
          .join("\n"),
        tags,
        origin: "model",
        vision: { name: model.name, digest: model.digest },
        frames,
        analyzedAt: new Date().toISOString(),
        embedding: null,
      });
      if ((await fingerprint(binding)) !== entry.fingerprint)
        throw new Error("Media changed during analysis.");
      const at = catalog.entries.findIndex((e) => e.asset.id === id);
      if (at < 0) catalog.entries.push(entry);
      else catalog.entries[at] = entry;
    }
    message = "Completed visual analysis. Video observations cover only the sampled frames.";
  }
  if (operation.action === "edit") {
    const binding = bindings[0],
      old = valid.find((e) => e.asset.id === binding.id);
    const { id, filename, type, mimeType, size, importedAt, duration, width, height } =
      binding.asset;
    const entry = entrySchema.parse({
      ...old,
      asset: projectAssetSchema.parse({
        id,
        filename,
        type,
        mimeType,
        size,
        importedAt,
        ...(duration ? { duration } : {}),
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
      }),
      fingerprint: fingerprints.get(id),
      description: operation.description,
      tags: operation.tags,
      origin: "manual",
      vision: old?.vision ?? null,
      frames: old?.frames ?? [],
      analyzedAt: new Date().toISOString(),
      embedding: null,
    });
    const at = catalog.entries.findIndex((e) => e.asset.id === id);
    if (at < 0) catalog.entries.push(entry);
    else catalog.entries[at] = entry;
    message = "Reviewed description saved. Its old embedding was invalidated.";
  }
  if (operation.action === "embed") {
    const model = (await adapter.discover()).find((m) => m.name === operation.model && m.embedding);
    if (!model) throw new Error("Select an installed model advertising embedding capability.");
    if (valid.length !== bindings.length)
      throw new Error("Analyze or describe every selected asset before embedding.");
    const pending = valid.filter(
      (e) =>
        !e.embedding ||
        e.embedding.model.name !== model.name ||
        e.embedding.model.digest !== model.digest ||
        e.embedding.sourceHash !== textHash(e),
    );
    progress(`Embedding ${pending.length} descriptions`, null);
    const vectors = await adapter.embed(
      model,
      pending.map((e) => `${e.description}\nTags: ${e.tags.join(", ")}`),
    );
    pending.forEach((entry, i) => {
      const index = catalog.entries.findIndex((e) => e.asset.id === entry.asset.id);
      catalog.entries[index] = entrySchema.parse({
        ...entry,
        embedding: {
          model: { name: model.name, digest: model.digest },
          sourceHash: textHash(entry),
          vector: vectors[i],
        },
      });
    });
    message = "Description embeddings cached for the selected model revision.";
  }
  if (["analyze", "edit", "embed"].includes(operation.action)) {
    for (const binding of bindings) await fingerprint(binding);
    await writeIndex(context.directory, catalog);
  }
  const entries = catalog.entries.filter(
    (e) => requested.has(e.asset.id) && fingerprints.get(e.asset.id) === e.fingerprint,
  );
  /** @type {import("zod").infer<typeof import("../core/assets/index-schema.cjs").matchSchema>[]} */
  let matches = [];
  if (operation.action === "search") {
    let model;
    let vector;
    if (operation.model) {
      model = (await adapter.discover()).find((m) => m.name === operation.model && m.embedding);
      if (!model)
        throw new Error(
          "Selected embedding model is unavailable. Use metadata search or select an installed model.",
        );
      [vector] = await adapter.embed(model, [operation.query]);
    }
    matches = rank(entries, operation.query, {
      model,
      vector,
      type: operation.type,
      aspectRatio: operation.aspectRatio,
      duration: operation.duration,
    });
    message = vector
      ? "Hybrid semantic/metadata ranking; scores are not probabilities."
      : "Keyword/tag metadata ranking only; no semantic model was used.";
  }
  return resultSchema.parse({
    kind: "assets",
    entries: entries.map(({ embedding, ...entry }) => ({
      ...entry,
      embeddingModel: embedding?.model ?? null,
    })),
    models: [],
    matches,
    message,
  });
}
module.exports = { contextSchema, runAssets, frame };
