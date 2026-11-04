const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mergeAssets, filterAssets, formatDuration, formatSize } = require("./library.cjs");

test("session merge preserves selection IDs and replaces metadata without duplicates", () => {
  const current = [{ id: "1", filename: "Opening.PNG", type: "image" }, { id: "2", filename: "Music.wav", type: "audio" }];
  const merged = mergeAssets(current, [{ ...current[0], width: 1920 }, { id: "3", filename: "Opening.mp4", type: "video" }]);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].width, 1920);
  assert.deepEqual(filterAssets(merged, " opening ", "all").map((asset) => asset.id), ["1", "3"]);
  assert.deepEqual(filterAssets(merged, "OPENING", "video").map((asset) => asset.id), ["3"]);
  assert.equal(filterAssets(merged, "missing", "all").length, 0);
});

test("metadata formatting handles missing durations, hours, and file sizes", () => {
  assert.equal(formatDuration(undefined), "--:--");
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(3661.9), "1:01:01");
  assert.equal(formatSize(1024), "1.0 KB");
  assert.equal(formatSize(0), "0 B");
});
