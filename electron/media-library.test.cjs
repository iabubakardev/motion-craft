const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createMediaLibrary, parseRange } = require("./media-library.cjs");
const { mediaAssetSchema, mediaMetadataSchema } = require("../core/media/schema.cjs");

test("imports multiple files, deduplicates canonical paths, and never exposes trusted paths", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "motioncraft-media-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const image = path.join(directory, "sample.PNG");
  const audio = path.join(directory, "sample.wav");
  await fs.writeFile(image, "image-bytes");
  await fs.writeFile(audio, "audio-bytes");
  const library = createMediaLibrary();
  const result = await library.importFiles([
    image,
    audio,
    image,
    path.join(directory, "missing.mp4"),
    path.join(directory, "bad.txt"),
  ]);
  assert.equal(result.assets.length, 3);
  assert.equal(result.duplicates, 1);
  assert.equal(result.errors.length, 2);
  assert.equal(library.listAssets().length, 2);
  assert.equal(result.assets[0].id, result.assets[2].id);
  assert.equal(JSON.stringify(result).includes(directory), false);
  assert.equal(JSON.stringify(result).includes("originalPath"), false);
  assert.equal(result.assets[0].mimeType, "image/png");
  assert.equal(
    mediaAssetSchema.safeParse({ ...result.assets[0], originalPath: image }).success,
    false,
  );
  assert.equal(
    mediaAssetSchema.safeParse({ ...result.assets[0], url: "file:///secret.png" }).success,
    false,
  );
  assert.equal(mediaAssetSchema.safeParse({ ...result.assets[0], type: "video" }).success, false);
  assert.equal(
    mediaMetadataSchema.safeParse({ status: "ready", duration: Infinity }).success,
    false,
  );
  assert.equal(mediaMetadataSchema.safeParse({ status: "ready", path: image }).success, false);
  library.updateMetadata(result.assets[0].id, { status: "ready", width: 32, height: 16 });
  assert.equal(library.listAssets()[0].width, 32);
  library.updateMetadata(result.assets[0].id, { status: "error" });
  await library.importFiles([image]);
  assert.equal(library.listAssets()[0].status, "imported");
  assert.throws(() => library.updateMetadata("bad-id", { status: "ready" }));
});

test("media protocol restricts IDs/methods and streams byte ranges without path access", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "motioncraft-stream-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "clip.mp4");
  await fs.writeFile(filename, "0123456789");
  const library = createMediaLibrary();
  const {
    assets: [asset],
  } = await library.importFiles([filename]);
  const get = (url = asset.url, options) => library.respond(new Request(url, options));
  const all = await get();
  assert.equal(all.status, 200);
  assert.equal(all.headers.get("content-type"), "video/mp4");
  assert.equal(await all.text(), "0123456789");
  const temporal = await get(asset.url + "#t=1,2");
  assert.equal(temporal.status, 200);
  assert.equal(await temporal.text(), "0123456789");
  for (const fragment of [
    "#anything",
    "#t=-1",
    "#t=2,1",
    "#t=0,86401",
    "#t=Infinity",
    "#t=0?path=secret",
  ])
    assert.equal((await get(asset.url + fragment)).status, 404, fragment);
  const range = await get(asset.url, { headers: { Range: "bytes=2-5" } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(await range.text(), "2345");
  const suffix = await get(asset.url, { headers: { Range: "bytes=-3" } });
  assert.equal(await suffix.text(), "789");
  assert.equal((await get(asset.url, { method: "HEAD" })).headers.get("content-length"), "10");
  assert.equal((await get(asset.url, { headers: { Range: "bytes=99-" } })).status, 416);
  assert.equal((await get(asset.url, { method: "POST" })).status, 405);
  for (const url of [
    asset.url + "?path=secret",
    "motioncraft-media://asset/../../secret",
    "motioncraft-media://other/" + asset.id,
    "motioncraft-media://asset/00000000-0000-4000-8000-000000000000",
  ]) {
    assert.equal((await get(url)).status, 404, url);
  }
  await fs.writeFile(filename, "changed");
  assert.equal((await get()).status, 410);
  const replacement = await library.importFiles([filename]);
  assert.notEqual(replacement.assets[0].id, asset.id);
  await fs.unlink(filename);
  assert.equal((await get(replacement.assets[0].url)).status, 410);
});

test("range parsing rejects malformed and multi-range requests", () => {
  assert.deepEqual(parseRange("bytes=2-", 10), { start: 2, end: 9 });
  assert.deepEqual(parseRange("bytes=0-999", 10), { start: 0, end: 9 });
  for (const range of [
    "bytes=",
    "bytes=-0",
    "bytes=9-2",
    "bytes=1-2,4-5",
    "items=0-1",
    "bytes=99999999999999999999-",
  ]) {
    assert.throws(() => parseRange(range, 10), range);
  }
});
