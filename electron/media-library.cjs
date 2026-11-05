const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Readable } = require("node:stream");
const {
  assetIdSchema,
  mediaAssetSchema,
  mediaAssetsSchema,
  mediaMetadataSchema,
  importResultSchema,
} = require("../core/media/schema.cjs");
const { DEV_URL } = require("./security.cjs");

const FORMATS = Object.freeze({
  ".mp4": ["video", "video/mp4"],
  ".mov": ["video", "video/quicktime"],
  ".webm": ["video", "video/webm"],
  ".mp3": ["audio", "audio/mpeg"],
  ".wav": ["audio", "audio/wav"],
  ".png": ["image", "image/png"],
  ".jpg": ["image", "image/jpeg"],
  ".jpeg": ["image", "image/jpeg"],
  ".webp": ["image", "image/webp"],
});
const MEDIA_EXTENSIONS = Object.keys(FORMATS).map((extension) => extension.slice(1));

// Remotion/HTML media use temporal fragments. They never affect asset lookup or paths.
function validMediaFragment(hash) {
  if (!hash) return true;
  const match = /^#t=(\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?))?$/.exec(hash);
  if (!match) return false;
  const start = Number(match[1]),
    end = match[2] === undefined ? start : Number(match[2]);
  return Number.isFinite(start) && start >= 0 && end >= start && end <= 86400;
}

function parseRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) throw new Error("Invalid range");
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(Number(match[2]), size - 1) : size - 1) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start > end ||
    start >= size
  )
    throw new Error("Invalid range");
  return { start, end };
}

function createMediaLibrary() {
  // Trusted records never cross IPC: absolute paths exist only in this registry.
  const records = new Map();
  const paths = new Map();
  const keyFor = (value) => (process.platform === "win32" ? value.toLowerCase() : value);

  async function importFiles(filePaths) {
    const assets = [];
    const errors = [];
    let duplicates = 0;
    for (const selectedPath of filePaths) {
      const filename = path.basename(selectedPath);
      try {
        const format = FORMATS[path.extname(selectedPath).toLowerCase()];
        if (!format) throw new Error("Unsupported file type.");
        const originalPath = await fs.realpath(selectedPath);
        const stat = await fs.stat(originalPath);
        if (!stat.isFile() || stat.size === 0)
          throw new Error("The file is empty or is not a regular file.");
        const key = keyFor(originalPath);
        const existing = records.get(paths.get(key));
        if (
          existing &&
          existing.size === stat.size &&
          existing.modifiedAt === stat.mtimeMs &&
          existing.ino === stat.ino
        ) {
          duplicates++;
          // A failed decode may be retried by importing the file again.
          if (existing.asset.status === "error") existing.asset.status = "imported";
          assets.push(mediaAssetSchema.parse(existing.asset));
          continue;
        }
        const id = randomUUID();
        const url = `motioncraft-media://asset/${id}`;
        const asset = mediaAssetSchema.parse({
          id,
          filename,
          type: format[0],
          url,
          mimeType: format[1],
          size: stat.size,
          importedAt: new Date().toISOString(),
          status: "imported",
          ...(format[0] === "image" ? { thumbnailUrl: url } : {}),
        });
        records.set(id, {
          asset,
          originalPath,
          size: stat.size,
          modifiedAt: stat.mtimeMs,
          ino: stat.ino,
        });
        paths.set(key, id);
        assets.push(asset);
      } catch (error) {
        // Do not leak filesystem paths in errors returned to the renderer.
        const message =
          error.code === "ENOENT"
            ? "The file no longer exists."
            : error.code === "EACCES" || error.code === "EPERM"
              ? "Permission to read this file was denied."
              : ["Unsupported file type.", "The file is empty or is not a regular file."].includes(
                    error.message,
                  )
                ? error.message
                : "The file could not be imported.";
        errors.push({ filename, message });
      }
    }
    return importResultSchema.parse({ canceled: false, assets, duplicates, errors });
  }

  function listAssets() {
    return mediaAssetsSchema.parse([...records.values()].map((record) => record.asset));
  }

  function updateMetadata(id, metadata) {
    assetIdSchema.parse(id);
    const parsed = mediaMetadataSchema.parse(metadata);
    const record = records.get(id);
    if (!record) throw new Error("Unknown media asset.");
    record.asset = mediaAssetSchema.parse({ ...record.asset, ...parsed });
    return record.asset;
  }

  function captureBindings(assets) {
    return assets.flatMap((asset) => {
      const record = records.get(asset.id);
      return record?.originalPath &&
        record.asset.size === asset.size &&
        record.asset.mimeType === asset.mimeType
        ? [
            {
              id: asset.id,
              originalPath: record.originalPath,
              size: record.size,
              modifiedAt: record.modifiedAt,
              ino: record.ino,
              type: record.asset.type,
              mimeType: record.asset.mimeType,
            },
          ]
        : [];
    });
  }

  async function restoreAssets(assets, bindings) {
    const restored = [];
    for (const descriptor of assets) {
      const url = `motioncraft-media://asset/${descriptor.id}`;
      let record = records.get(descriptor.id);
      if (record?.originalPath) {
        try {
          const canonical = await fs.realpath(record.originalPath);
          const stat = await fs.stat(canonical);
          if (
            !stat.isFile() ||
            keyFor(canonical) !== keyFor(record.originalPath) ||
            stat.size !== record.size ||
            stat.mtimeMs !== record.modifiedAt ||
            stat.ino !== record.ino
          )
            record = null;
        } catch {
          record = null;
        }
      }
      if (
        !record?.originalPath ||
        record.asset.size !== descriptor.size ||
        record.asset.mimeType !== descriptor.mimeType
      ) {
        record = null;
        const binding = bindings.find(
          (item) =>
            item.id === descriptor.id &&
            item.size === descriptor.size &&
            item.mimeType === descriptor.mimeType &&
            item.type === descriptor.type,
        );
        if (binding) {
          try {
            const canonical = await fs.realpath(binding.originalPath);
            const stat = await fs.stat(canonical);
            if (
              keyFor(canonical) === keyFor(binding.originalPath) &&
              stat.isFile() &&
              stat.size === binding.size &&
              stat.mtimeMs === binding.modifiedAt &&
              stat.ino === binding.ino
            ) {
              record = {
                originalPath: canonical,
                size: stat.size,
                modifiedAt: stat.mtimeMs,
                ino: stat.ino,
              };
            }
          } catch {
            /* Missing/moved files remain declared assets with unavailable previews. */
          }
        }
      }
      const asset = mediaAssetSchema.parse({
        ...descriptor,
        url,
        status: record ? "imported" : "error",
        ...(descriptor.type === "image" ? { thumbnailUrl: url } : {}),
      });
      // Paths originate only in native selection or the trusted local binding catalog.
      records.set(descriptor.id, { ...(record || { originalPath: null }), asset });
      if (record?.originalPath) paths.set(keyFor(record.originalPath), descriptor.id);
      restored.push(asset);
    }
    return mediaAssetsSchema.parse(restored);
  }

  async function relinkAsset(descriptor, selectedPath) {
    const format = FORMATS[path.extname(selectedPath).toLowerCase()];
    if (!format || format[0] !== descriptor.type)
      throw new Error("Select the same media type as the missing asset.");
    const result = await importFiles([selectedPath]);
    if (!result.assets[0])
      throw new Error(result.errors[0]?.message || "Media could not be relinked.");
    const source = records.get(result.assets[0].id);
    const url = `motioncraft-media://asset/${descriptor.id}`;
    const asset = mediaAssetSchema.parse({
      ...source.asset,
      id: descriptor.id,
      url,
      status: "imported",
      ...(descriptor.type === "image" ? { thumbnailUrl: url } : {}),
    });
    records.set(descriptor.id, { ...source, asset });
    paths.set(keyFor(source.originalPath), descriptor.id);
    return asset;
  }

  async function respond(request) {
    const headers = {
      "Access-Control-Allow-Origin": DEV_URL,
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    };
    const fail = (status) => new Response(null, { status, headers });
    if (!["GET", "HEAD"].includes(request.method)) return fail(405);
    let file;
    try {
      const url = new URL(request.url);
      if (
        url.protocol !== "motioncraft-media:" ||
        url.host !== "asset" ||
        url.username ||
        url.password ||
        url.search ||
        !validMediaFragment(url.hash)
      )
        return fail(404);
      const parsedId = assetIdSchema.safeParse(url.pathname.slice(1));
      const record = parsedId.success ? records.get(parsedId.data) : null;
      if (!record) return fail(404);
      // Reject changed/replaced files and symlinks instead of silently reading a new target.
      const resolved = await fs.realpath(record.originalPath);
      if (keyFor(resolved) !== keyFor(record.originalPath)) return fail(410);
      file = await fs.open(resolved, "r");
      const stat = await file.stat();
      if (
        !stat.isFile() ||
        stat.size !== record.size ||
        stat.mtimeMs !== record.modifiedAt ||
        stat.ino !== record.ino
      )
        return fail(410);
      headers["Content-Type"] = record.asset.mimeType;
      let range;
      try {
        range = parseRange(request.headers.get("range"), stat.size);
      } catch {
        headers["Content-Range"] = `bytes */${stat.size}`;
        return fail(416);
      }
      headers["Content-Length"] = String(range ? range.end - range.start + 1 : stat.size);
      if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${stat.size}`;
      const status = range ? 206 : 200;
      if (request.method === "HEAD") return new Response(null, { status, headers });
      const stream = file.createReadStream({ ...(range || {}), autoClose: true });
      file = null; // Stream owns the handle from here; cancellation closes it too.
      return new Response(Readable.toWeb(stream), { status, headers });
    } catch {
      return fail(410);
    } finally {
      if (file) await file.close();
    }
  }

  return {
    importFiles,
    listAssets,
    updateMetadata,
    respond,
    captureBindings,
    restoreAssets,
    relinkAsset,
  };
}

module.exports = { createMediaLibrary, MEDIA_EXTENSIONS, parseRange };
