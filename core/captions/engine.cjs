// @ts-check
const { groupingSchema, wordSchema } = require("./schema.cjs");
const { z } = require("zod");
/** @param {unknown} input @param {unknown} options */
function groupWords(input, options) {
  const words = z.array(wordSchema).max(20000).parse(input),
    settings = groupingSchema.parse(options);
  /** @type {typeof words[]} */ const groups = [];
  /** @type {typeof words} */ let group = [];
  /** @param {typeof words} input */
  function wrap(input) {
    const lines = [""];
    for (const word of input) {
      const text = word.text.trim();
      if (
        lines[lines.length - 1] &&
        lines[lines.length - 1].length + text.length + 1 > settings.maxCharacters
      )
        lines.push("");
      lines[lines.length - 1] += (lines[lines.length - 1] ? " " : "") + text;
    }
    return lines;
  }
  for (const word of words) {
    if (word.text.trim().length > settings.maxCharacters)
      throw new Error(
        "An aligned word exceeds the character limit. Increase the limit to preserve whole words.",
      );
    if (word.end - word.start > settings.maxSeconds)
      throw new Error(
        "An aligned word exceeds the duration limit. Increase the duration to preserve its timing.",
      );
    const last = group[group.length - 1];
    const text = [...group.map((w) => w.text.trim()), word.text.trim()].join(" ");
    if (
      group.length &&
      (settings.mode === "word" ||
        group.length >= settings.maxWords ||
        text.length > settings.maxCharacters * settings.maxLines ||
        wrap([...group, word]).length > settings.maxLines ||
        word.end - group[0].start > settings.maxSeconds ||
        word.start - last.end >= settings.pauseSeconds ||
        (settings.mode === "sentence" && /[.!?]$/.test(last.text.trim())))
    ) {
      groups.push(group);
      group = [];
    }
    group.push(word);
  }
  if (group.length) groups.push(group);
  return groups.map((group) => {
    const lines = wrap(group);
    return {
      start: group[0].start,
      end: group[group.length - 1].end,
      text: lines.join("\n"),
      words: group,
    };
  });
}
/** Frame-local seconds, no timers. Gaps have no active word.
 * @param {import('./presets.cjs').Caption} caption @param {number} frame @param {number} fps @param {number} durationFrames */
function captionFrame(caption, frame, fps, durationFrames) {
  const time = frame / fps,
    s = caption.style;
  let low = 0,
    high = caption.words.length - 1,
    active = -1;
  while (low <= high) {
    const mid = (low + high) >>> 1,
      w = caption.words[mid];
    if (time < w.start) high = mid - 1;
    else if (time >= w.end) low = mid + 1;
    else {
      active = mid;
      break;
    }
  }
  const count = Math.min(durationFrames / 2, s.animationSeconds * fps);
  let progress = count > 0 ? Math.max(0, Math.min(1, frame / count)) : 1;
  if (s.easing === "ease-out") progress = 1 - (1 - progress) ** 3;
  else if (s.easing === "ease-in") progress **= 3;
  else if (s.easing === "ease-in-out") progress = progress * progress * (3 - 2 * progress);
  const exit = count > 0 ? Math.max(0, Math.min(1, (durationFrames - 1 - frame) / count)) : 1;
  return {
    active,
    time,
    opacity: s.animation === "fade" ? Math.min(progress, exit) : 1,
    scale:
      s.animation === "pop"
        ? 0.7 + 0.3 * progress
        : s.animation === "bounce"
          ? 1 - 0.3 * Math.cos(progress * Math.PI * 3) * (1 - progress)
          : 1,
    slide: s.animation === "slide" ? 0.07 * (1 - progress) : 0,
  };
}
/** @param {{left:number,top:number,width:number,height:number}} rect @param {number} x @param {number} y */
function pointerToCanvas(rect, x, y) {
  if (
    ![rect.left, rect.top, rect.width, rect.height, x, y].every(Number.isFinite) ||
    rect.width <= 0 ||
    rect.height <= 0
  )
    throw new Error("Canvas is not measurable");
  return { x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height };
}
/** @param {{width:number,rotation:number}} box @param {{width:number,height:number}} rect @param {number} dx @param {number} dy */
function resizeCaptionWidth(box, rect, dx, dy) {
  const radians = (box.rotation * Math.PI) / 180;
  if (rect.width <= 0 || rect.height <= 0) throw new Error("Canvas is not measurable");
  return Math.max(
    0.05,
    Math.min(
      1,
      box.width +
        (2 * (dx * rect.width * Math.cos(radians) + dy * rect.height * Math.sin(radians))) /
          rect.width,
    ),
  );
}
/** Frame-derived typewriter fallback for subtitles without word alignment.
 * @param {string} text @param {number} frame @param {number} fps @param {number} seconds */
function revealText(text, frame, fps, seconds) {
  const characters = Array.from(text),
    progress = seconds > 0 ? Math.max(0, Math.min(1, frame / (fps * seconds))) : 1;
  return characters.slice(0, Math.floor(characters.length * progress)).join("");
}
/** Build short spoken pages once per document mapping, preserving exact alignment.
 * @param {import('./presets.cjs').Caption['words']} words */
function captionPages(words) {
  /** @type {{start:number,end:number}[]} */ const pages = [];
  let start = 0;
  for (let i = 1; i <= words.length; i++)
    if (
      i === words.length ||
      i - start >= 5 ||
      words[i].start - words[i - 1].end >= 0.6 ||
      /[.!?]$/.test(words[i - 1].text.trim())
    ) {
      pages.push({ start, end: i });
      start = i;
    }
  return pages;
}
/** @param {string} mode @param {number} active @param {{start:number,end:number}[]} pages @param {number} length */
function captionWordWindow(mode, active, pages, length) {
  if (mode === "full") return { start: 0, end: length };
  if (active < 0) return { start: 0, end: 0 };
  if (mode === "word") return { start: active, end: active + 1 };
  let low = 0,
    high = pages.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1,
      p = pages[mid];
    if (active < p.start) high = mid - 1;
    else if (active >= p.end) low = mid + 1;
    else return p;
  }
  return { start: active, end: active + 1 };
}
module.exports = {
  captionPages,
  captionWordWindow,
  groupWords,
  captionFrame,
  pointerToCanvas,
  resizeCaptionWidth,
  revealText,
};
