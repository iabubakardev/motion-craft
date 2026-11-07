// @ts-check
const fs = require("node:fs/promises"),
  path = require("node:path"),
  { fork } = require("node:child_process"),
  { randomUUID } = require("node:crypto");
const { analysisSchema } = require("../core/audio/schema.cjs"),
  { killTree } = require("./child-process.cjs");
/** @param {string} directory */
function createAudioService(directory) {
  /** @type {Map<string,{cancel:()=>void}>} */ const active = new Map();
  /** @type {Map<number,number>} */ const epochs = new Map();
  /** @type {Map<string,number>} */ const versions = new Map();
  /** @type {Promise<unknown>} */
  let tail = Promise.resolve();
  /** @type {Map<string,{signature:string,promise:Promise<unknown>}>} */
  const pending = new Map();
  /** @param {number} owner @param {string} key @param {Record<string,unknown>} request @returns {Promise<unknown>} */
  function run(owner, key, request) {
    const identity = owner + ":" + key;
    const signature = JSON.stringify(request, (name, value) =>
      [
        "updatedAt",
        "createdAt",
        "name",
        "visual",
        "animations",
        "resolution",
        "captionIds",
        "transcripts",
      ].includes(name)
        ? undefined
        : value,
    );
    const existing = pending.get(identity);
    if (existing?.signature === signature) return existing.promise;
    const epoch = epochs.get(owner) ?? 0,
      version = (versions.get(identity) ?? 0) + 1;
    versions.set(identity, version);
    if (key === "mix" && active.has(identity)) active.get(identity)?.cancel();
    const queued = tail
      .catch(() => {})
      .then(() => {
        if (
          (epochs.get(owner) ?? 0) !== epoch ||
          (key === "mix" && versions.get(identity) !== version)
        )
          throw new Error("Audio request superseded.");
        return new Promise((resolve, reject) => {
          /** @type {import("node:child_process").ForkOptions & {windowsHide:boolean}} */
          const options = {
            execPath: process.execPath,
            execArgv: [],
            env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
            windowsHide: true,
            stdio: ["ignore", "ignore", "ignore", "ipc"],
          };
          const child = fork(path.join(__dirname, "../workers/audio.cjs"), [], options);
          let finished = false;
          const cancel = () => {
            killTree(child);
            done(new Error("Audio processing canceled."));
          };
          /** @param {Error|null} error @param {unknown} [value] */ const done = (error, value) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            active.delete(identity);
            if (error) reject(error);
            else resolve(value);
          };
          const timer = setTimeout(cancel, 30 * 60 * 1000);
          active.set(identity, { cancel });
          child.once("message", (message) => {
            const parsed = require("zod")
              .z.discriminatedUnion("ok", [
                require("zod")
                  .z.object({
                    ok: require("zod").z.literal(true),
                    result: require("zod").z.unknown(),
                  })
                  .strict(),
                require("zod")
                  .z.object({
                    ok: require("zod").z.literal(false),
                    error: require("zod").z.string().max(250),
                  })
                  .strict(),
              ])
              .safeParse(message);
            if (!parsed.success) done(new Error("Invalid audio worker response."));
            else if (parsed.data.ok) done(null, parsed.data.result);
            else done(new Error(parsed.data.error));
          });
          child.once("error", () => done(new Error("Could not start local audio processing.")));
          child.once("exit", () => {
            if (!finished) done(new Error("Audio processing stopped before completion."));
          });
          child.send({ ...request, directory });
        });
      });
    const published = queued.finally(() => {
      if (pending.get(identity)?.promise === published) pending.delete(identity);
    });
    pending.set(identity, { signature, promise: published });
    tail = published;
    return published;
  }
  return {
    /** @param {number} owner @param {import("zod").infer<typeof import("../rendering/contracts.cjs").workerRequestSchema>["bindings"][number]} binding @param {{start:number,end:number}|undefined} [range] */
    analyze: async (owner, binding, range) =>
      analysisSchema.parse(
        await run(owner, "analysis:" + binding.id, {
          action: "analyze",
          binding,
          ...(range ? { range } : {}),
        }),
      ),
    /** @param {number} owner @param {import("../core/project/types").Project} project @param {import("zod").infer<typeof import("../rendering/contracts.cjs").workerRequestSchema>["bindings"]} bindings */
    mix: async (owner, project, bindings, jobKey = "mix") => {
      const filename = await run(owner, jobKey, { action: "mix", project, bindings });
      if (
        typeof filename !== "string" ||
        path.dirname(filename) !== directory ||
        !/^[a-f0-9]{64}\.wav$/.test(path.basename(filename))
      )
        throw new Error("Invalid generated audio.");
      const s = await fs.lstat(filename).catch(() => {
        throw new Error("Prepared audio is unavailable. Retry mix preparation.");
      });
      if (!s.isFile() || (await fs.realpath(filename)) !== filename)
        throw new Error("Prepared audio cache identity changed. Retry mix preparation.");
      return require("../rendering/contracts.cjs").workerRequestSchema.shape.bindings.element.parse(
        {
          id: randomUUID(),
          originalPath: filename,
          size: s.size,
          modifiedAt: s.mtimeMs,
          ino: s.ino,
          type: "audio",
          mimeType: "audio/wav",
        },
      );
    },
    /** @param {number} owner */
    release: (owner) => {
      for (const key of pending.keys()) if (key.startsWith(owner + ":")) pending.delete(key);
      epochs.set(owner, (epochs.get(owner) ?? 0) + 1);
      for (const [key, job] of active) if (key.startsWith(owner + ":")) job.cancel();
    },
  };
}
module.exports = { createAudioService };
