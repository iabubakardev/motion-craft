const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { z } = require("zod");
const { idSchema, projectSchema, MAX_JSON_BYTES, parseProjectJSON, serializeProject } = require("../core/project/schema.cjs");

const bindingsSchema = z.object({ version: z.literal(1), assets: z.array(z.object({
  id: idSchema, originalPath: z.string().min(1).max(32768), size: z.number().int().nonnegative(),
  modifiedAt: z.number().finite(), ino: z.number().finite(), type: z.enum(["image", "video", "audio"]), mimeType: z.string(),
}).strict()).max(10000) }).strict();

async function readSmallFile(filename) {
  const file = await fs.open(filename, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_JSON_BYTES) throw new Error("Project file must be a regular JSON file no larger than 5 MB.");
    const buffer = Buffer.alloc(MAX_JSON_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await file.read(buffer, total, buffer.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > MAX_JSON_BYTES) throw new Error("Project file exceeds 5 MB.");
    return buffer.subarray(0, total).toString("utf8");
  } finally { await file.close(); }
}

async function atomicWrite(filename, text) {
  const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.${randomUUID()}.tmp`);
  let file;
  try {
    file = await fs.open(temporary, "wx", 0o600);
    await file.writeFile(text, "utf8");
    await file.sync();
    await file.close(); file = null;
    await fs.rename(temporary, filename);
  } finally {
    if (file) await file.close();
    await fs.unlink(temporary).catch(() => {});
  }
}

function createProjectStore(bindingDirectory, library) {
  const bindingFile = (id) => path.join(bindingDirectory, `${idSchema.parse(id)}.media.json`);
  async function readBindings(id) {
    try { return bindingsSchema.parse(JSON.parse(await readSmallFile(bindingFile(id)))).assets; }
    catch { return []; }
  }
  async function read(filename) {
    try { return parseProjectJSON(await readSmallFile(filename)); }
    catch { return { success: false, errors: [{ path: "file", message: "Unable to read this project. It may be missing, unreadable, or larger than 5 MB." }] }; }
  }
  async function save(filename, value) {
    const project = projectSchema.parse(value);
    const json = serializeProject(project);
    if (Buffer.byteLength(json, "utf8") > MAX_JSON_BYTES) throw new Error("Project JSON exceeds 5 MB.");
    const previous = await readBindings(project.id);
    const byId = new Map(previous.map((item) => [item.id, item]));
    for (const binding of library.captureBindings(project.assets)) byId.set(binding.id, binding);
    // Retain previous approved IDs so a failed save or older project copy can still resolve its media.
    const bindings = bindingsSchema.parse({ version: 1, assets: [...byId.values()] });
    const bindingText = JSON.stringify(bindings);
    if (Buffer.byteLength(bindingText, "utf8") > MAX_JSON_BYTES) throw new Error("The local media binding catalog exceeds 5 MB.");
    await fs.mkdir(bindingDirectory, { recursive: true });
    // Catalog first: a failed project write cannot replace the previous project JSON.
    await atomicWrite(bindingFile(project.id), bindingText);
    await atomicWrite(filename, json);
  }
  async function resolve(value) {
    const project = projectSchema.parse(value);
    const assets = await library.restoreAssets(project.assets, await readBindings(project.id));
    return { assets, missingAssetIds: assets.filter((asset) => asset.status === "error").map((asset) => asset.id) };
  }
  return { read, save, resolve };
}

module.exports = { createProjectStore, atomicWrite, readSmallFile };
