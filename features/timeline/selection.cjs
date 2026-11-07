// @ts-check
/** @typedef {{left:number,top:number,width:number,height:number}} Rect */
/** @param {{x:number,y:number}} a @param {{x:number,y:number}} b @returns {Rect} */
function selectionBounds(a, b) {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}
/** @param {Rect} box @param {{id:string,rect:Rect}[]} items @param {string[]} [previous] */
function selectInBox(box, items, previous = []) {
  return [
    ...new Set([
      ...previous,
      ...items
        .filter(
          ({ rect: r }) =>
            r.left < box.left + box.width &&
            r.left + r.width > box.left &&
            r.top < box.top + box.height &&
            r.top + r.height > box.top,
        )
        .map((item) => item.id),
    ]),
  ];
}
module.exports = { selectionBounds, selectInBox };
