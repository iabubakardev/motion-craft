// @ts-check
/** @typedef {import('zod').infer<typeof import('./schema.cjs').keyframeSchema>} Key */
/** @typedef {Key['easing']} Ease */
/** @param {string} seed */
function stableId(seed) {
  let text = "";
  for (let i = 0; i < 4; i++) {
    let hash = (2166136261 + i * 2654435761) >>> 0;
    for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    text += hash.toString(16).padStart(8, "0");
  }
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-5${text.slice(13, 16)}-8${text.slice(17, 20)}-${text.slice(20, 32)}`;
}
/** @param {number} a @param {number} b @param {number} t */
const mix = (a, b, t) => a + (b - a) * t;
/** @param {number} t @param {number} a @param {number} b */
function cubic(t, a, b) {
  return 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
}
/** @param {Ease} ease @returns {[number,number,number,number]} */
function controls(ease) {
  return ease.type === "bezier"
    ? ease.control || [0, 0, 1, 1]
    : ease.type === "ease-in"
      ? [0.42, 0, 1, 1]
      : ease.type === "ease-out"
        ? [0, 0, 0.58, 1]
        : ease.type === "ease-in-out"
          ? [0.42, 0, 0.58, 1]
          : [0, 0, 1, 1];
}
/** @param {number} x @param {number[]} c */
function parameter(x, c) {
  let low = 0,
    high = 1;
  for (let i = 0; i < 45; i++) {
    const mid = (low + high) / 2;
    if (cubic(mid, c[0], c[2]) < x) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}
/** @param {number} progress @param {Ease} ease */
function easing(progress, ease) {
  const x = Math.max(0, Math.min(1, progress));
  if (x === 0 || x === 1 || ease.type === "linear") return x;
  const c = controls(ease);
  return cubic(parameter(x, c), c[1], c[3]);
}
/** @param {Key[]} keys @param {number} frame @param {number} fallback */
function evaluate(keys, frame, fallback) {
  if (!keys.length) return fallback;
  if (frame <= keys[0].frame) return keys[0].value;
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return last.value;
  let low = 0,
    high = keys.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >>> 1;
    if (keys[mid].frame <= frame) low = mid;
    else high = mid;
  }
  const a = keys[low],
    b = keys[high];
  return mix(a.value, b.value, easing((frame - a.frame) / (b.frame - a.frame), a.easing));
}
/** @param {Key[]} keys @param {Record<Key['property'],number>} base @param {number} frame */
function pose(keys, base, frame) {
  const result = { ...base };
  for (const name of require("./schema.cjs").propertySchema.options) {
    result[name] = evaluate(
      keys.filter((k) => k.property === name).sort((a, b) => a.frame - b.frame),
      frame,
      base[name],
    );
  }
  return result;
}
/** @param {number[][]} points @param {number} t */
function splitCurve(points, t) {
  const a = points
      .slice(0, -1)
      .map((p, i) => [mix(p[0], points[i + 1][0], t), mix(p[1], points[i + 1][1], t)]),
    b = a.slice(0, -1).map((p, i) => [mix(p[0], a[i + 1][0], t), mix(p[1], a[i + 1][1], t)]),
    p = [mix(b[0][0], b[1][0], t), mix(b[0][1], b[1][1], t)];
  return { left: [points[0], a[0], b[0], p], right: [p, b[1], a[2], points[3]] };
}
/** @param {Ease} ease @param {number} from @param {number} to @returns {Ease} */
function cropEase(ease, from, to) {
  if (ease.type === "linear") return ease;
  const c = controls(ease),
    t0 = parameter(from, c),
    t1 = parameter(to, c);
  let points = [
    [0, 0],
    [c[0], c[1]],
    [c[2], c[3]],
    [1, 1],
  ];
  if (t1 < 1) points = splitCurve(points, t1).left;
  if (t0 > 0) points = splitCurve(points, t0 / t1).right;
  const first = points[0],
    last = points[3],
    dx = last[0] - first[0],
    dy = last[1] - first[1];
  if (dx < 1e-10 || dy < 1e-10) return { type: "linear" };
  const normalized = points
    .slice(1, 3)
    .flatMap((p) => [(p[0] - first[0]) / dx, (p[1] - first[1]) / dy])
    .map((n) => Math.max(0, Math.min(1, n)));
  return { type: "bezier", control: [normalized[0], normalized[1], normalized[2], normalized[3]] };
}
/** Preserve the sampled curve, including nonlinear segments, in a new local interval.
 * @param {Key[]} keys @param {number} start @param {number} end @param {string} namespace @returns {Key[]} */
function cropKeys(keys, start, end, namespace) {
  /** @type {Key[]} */
  const result = [];
  for (const property of require("./schema.cjs").propertySchema.options) {
    const channel = keys.filter((k) => k.property === property).sort((a, b) => a.frame - b.frame);
    if (!channel.length) continue;
    const frames = [
      ...new Set([
        start,
        ...channel.filter((k) => k.frame > start && k.frame < end).map((k) => k.frame),
        end,
      ]),
    ].sort((a, b) => a - b);
    /** @type {Key[]} */
    const cropped = frames.map(
      /** @returns {Key} */ (frame) => {
        const existing = channel.find((k) => k.frame === frame);
        return {
          ...(existing || channel[0]),
          id: existing?.id || stableId(`${namespace}:${property}:${frame}`),
          frame: frame - start,
          value: evaluate(channel, frame, channel[0].value),
          easing: { type: "linear" },
        };
      },
    );
    for (let i = 0; i < cropped.length - 1; i++) {
      const begin = frames[i],
        finish = frames[i + 1],
        segment = channel.find(
          (k, j) => j < channel.length - 1 && k.frame <= begin && channel[j + 1].frame >= finish,
        );
      if (segment) {
        const next = channel[channel.indexOf(segment) + 1];
        cropped[i].easing = cropEase(
          segment.easing,
          (begin - segment.frame) / (next.frame - segment.frame),
          (finish - segment.frame) / (next.frame - segment.frame),
        );
      }
    }
    result.push(...cropped);
  }
  return result;
}
/** @param {string} name @param {number} duration @param {number} total @param {Record<Key['property'],number>} base @param {number} width @param {number} height @param {string} namespace @returns {Key[]} */
function presetKeys(name, duration, total, base, width, height, namespace) {
  /** @type {Key[]} */
  const keys = [];
  /** @param {Key['property']} property @param {number[]} values @param {number[]} frames */
  const add = (property, values, frames) =>
    values.forEach((value, i) =>
      keys.push({
        id: stableId(`${namespace}:${name}:${property}:${i}`),
        property,
        frame: frames[i],
        value,
        easing: { type: "ease-in-out" },
      }),
    );
  const end = duration - 1;
  if (name === "fade-in") add("opacity", [0, base.opacity], [0, end]);
  else if (name === "fade-out") add("opacity", [base.opacity, 0], [total - duration, total - 1]);
  else if (name.startsWith("slide")) {
    const horizontal = name === "slide-left" || name === "slide-right",
      property = horizontal ? "x" : "y",
      direction = name === "slide-left" || name === "slide-up" ? 1 : -1;
    add(
      property,
      [base[property] + direction * (horizontal ? width : height) * 0.25, base[property]],
      [0, end],
    );
  } else if (name === "pan") add("x", [base.x - width * 0.05, base.x + width * 0.05], [0, end]);
  else {
    const start =
        name === "zoom-in" ? 0.8 : name === "zoom-out" ? 1.2 : name === "pop-in" ? 0.65 : 1,
      finish = name === "documentary-zoom" ? 1.06 : 1;
    for (const axis of require("./schema.cjs").propertySchema.options.filter(
      (p) => p === "scaleX" || p === "scaleY",
    )) {
      if (name === "pop-in" && duration >= 3)
        add(
          axis,
          [Math.max(0.001, base[axis] * 0.65), Math.min(100, base[axis] * 1.08), base[axis]],
          [0, Math.max(1, Math.min(end - 1, Math.floor(end * 0.7))), end],
        );
      else
        add(
          axis,
          [Math.max(0.001, Math.min(100, base[axis] * start)), Math.min(100, base[axis] * finish)],
          [0, end],
        );
    }
  }
  return keys;
}
module.exports = { stableId, easing, evaluate, pose, cropKeys, presetKeys };
