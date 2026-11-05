// @ts-check
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { catalogSchema } = require("../core/assets/index-schema.cjs");
const MAX_BYTES = 16 * 1024 * 1024;
/** @param {string} directory */
async function readIndex(directory) {
  try {
    const filename = path.join(directory, "assets-v1.json");
    const stat = await fs.stat(filename);
    if (!stat.isFile() || stat.size > MAX_BYTES)
      throw new Error(
        "Asset index is invalid or too large. Preserve it and repair the index before retrying.",
      );
    return catalogSchema.parse(JSON.parse(await fs.readFile(filename, "utf8")));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return catalogSchema.parse({ version: 1, entries: [] });
    throw new Error("The asset index could not be read. Existing index data was preserved.");
  }
}
/** @param {string} directory @param {unknown} raw */
async function writeIndex(directory, raw) {
  const index = catalogSchema.parse(raw),
    text = JSON.stringify(index);
  if (Buffer.byteLength(text) > MAX_BYTES)
    throw new Error("Asset index exceeds the 16 MB limit. Existing index was kept.");
  await fs.mkdir(directory, { recursive: true });
  const temp = path.join(directory, `${randomUUID()}.partial.json`);
  try {
    const handle = await fs.open(temp, "wx");
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temp, path.join(directory, "assets-v1.json"));
  } finally {
    await fs.unlink(temp).catch(() => {});
  }
}
/** @param {{id:string,originalPath:string,size:number,modifiedAt:number,ino:number}} binding */
async function fingerprint(binding) {
  const real = await fs.realpath(binding.originalPath),
    stat = await fs.stat(real);
  if (
    real !== binding.originalPath ||
    !stat.isFile() ||
    stat.size !== binding.size ||
    stat.mtimeMs !== binding.modifiedAt ||
    stat.ino !== binding.ino
  )
    throw new Error("Media changed or is missing. Relink it before indexing.");
  return createHash("sha256")
    .update(JSON.stringify([real, stat.size, stat.mtimeMs, stat.ino]))
    .digest("hex");
}
/** @param {{description:string,tags:string[]}} entry */
function textHash(entry) {
  return createHash("sha256")
    .update(`${entry.description}\n${entry.tags.join(" ")}`)
    .digest("hex");
}
module.exports = { readIndex, writeIndex, fingerprint, textHash };
