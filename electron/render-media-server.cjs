// @ts-check
const http = require("node:http");
const fs = require("node:fs/promises");
const { randomBytes } = require("node:crypto");
const { parseRange } = require("./media-library.cjs");
/** @param {import('zod').infer<typeof import('../rendering/contracts.cjs').workerRequestSchema>['bindings']} bindings */
async function createRenderMediaServer(bindings) {
  const token = randomBytes(32).toString("hex"),
    registry = new Map(bindings.map((binding) => [binding.id, binding]));
  const server = http.createServer(async (request, response) => {
    const address = server.address();
    if (
      !address ||
      typeof address === "string" ||
      request.headers.host !== `127.0.0.1:${address.port}`
    ) {
      response.writeHead(403).end();
      return;
    }
    const origin = request.headers.origin;
    if (origin && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
      response.writeHead(403).end();
      return;
    }
    const match = new RegExp(`^/${token}/([0-9a-f-]{36})$`, "i").exec(request.url || "");
    const binding = match ? registry.get(match[1]) : undefined;
    if (!binding || !["GET", "HEAD"].includes(request.method || "")) {
      response.writeHead(404).end();
      return;
    }
    let file;
    try {
      const canonical = await fs.realpath(binding.originalPath);
      if (canonical !== binding.originalPath) throw new Error("Changed media");
      file = await fs.open(canonical, "r");
      const stat = await file.stat();
      if (
        !stat.isFile() ||
        stat.size !== binding.size ||
        stat.mtimeMs !== binding.modifiedAt ||
        stat.ino !== binding.ino
      )
        throw new Error("Changed media");
      let range;
      try {
        range = parseRange(request.headers.range, stat.size);
      } catch {
        response.writeHead(416, { "Content-Range": `bytes */${stat.size}` }).end();
        return;
      }
      response.writeHead(range ? 206 : 200, {
        "Content-Type": binding.mimeType,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
        "Accept-Ranges": "bytes",
        "Content-Length": range ? range.end - range.start + 1 : stat.size,
        ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
        ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}` } : {}),
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      const stream = file.createReadStream({ ...range, autoClose: true });
      file = undefined;
      response.on("close", () => stream.destroy());
      stream.on("error", () => response.destroy());
      stream.pipe(response);
    } catch {
      if (!response.headersSent) response.writeHead(410);
      response.end();
    } finally {
      await file?.close();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Media service unavailable");
  return {
    sources: Object.fromEntries(
      bindings.map((binding) => [
        binding.id,
        `http://127.0.0.1:${address.port}/${token}/${binding.id}`,
      ]),
    ),
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve(undefined));
        server.closeAllConnections();
      }),
  };
}
module.exports = { createRenderMediaServer };
