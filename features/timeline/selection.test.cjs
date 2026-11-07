const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { selectionBounds, selectInBox } = require("./selection.cjs");
test("box selection works in either direction across rows and adds without duplicate IDs", () => {
  const items = [
    { id: "a", rect: { left: 200, top: 40, width: 80, height: 30 } },
    { id: "b", rect: { left: 300, top: 40, width: 80, height: 30 } },
    { id: "c", rect: { left: 250, top: 90, width: 80, height: 30 } },
    { id: "far", rect: { left: 900, top: 40, width: 80, height: 30 } },
  ];
  const forward = selectionBounds({ x: 220, y: 45 }, { x: 350, y: 110 }),
    reverse = selectionBounds({ x: 350, y: 110 }, { x: 220, y: 45 });
  assert.deepEqual(forward, reverse);
  assert.deepEqual(selectInBox(forward, items), ["a", "b", "c"]);
  assert.deepEqual(selectInBox(forward, items, ["far", "a"]), ["far", "a", "b", "c"]);
  assert.deepEqual(selectInBox({ left: 0, top: 0, width: 200, height: 40 }, items), []);
});
test("content coordinates select clips beyond a scrolled viewport without depending on DOM virtualization", () => {
  const items = Array.from({ length: 2000 }, (_, i) => ({
    id: String(i),
    rect: { left: 196 + i * 10, top: 30, width: 8, height: 40 },
  }));
  assert.deepEqual(selectInBox(selectionBounds({ x: 10195, y: 30 }, { x: 10225, y: 70 }), items), [
    "1000",
    "1001",
    "1002",
  ]);
});
