/** @typedef {import('../../core/media/types').MediaAsset} MediaAsset */

/** @param {MediaAsset[]} current @param {MediaAsset[]} incoming */
function mergeAssets(current, incoming) {
  const byId = new Map(current.map((asset) => [asset.id, asset]));
  for (const asset of incoming) byId.set(asset.id, asset);
  return [...byId.values()];
}

/** @param {MediaAsset[]} assets @param {string} search @param {string} type */
function filterAssets(assets, search, type) {
  const query = search.trim().toLowerCase();
  return assets.filter((asset) => (type === "all" || asset.type === type) && asset.filename.toLowerCase().includes(query));
}

/** @param {number} bytes */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** @param {number | undefined} seconds */
function formatDuration(seconds) {
  if (seconds === undefined || !Number.isFinite(seconds)) return "--:--";
  const rounded = Math.floor(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const rest = String(rounded % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

module.exports = { mergeAssets, filterAssets, formatSize, formatDuration };
