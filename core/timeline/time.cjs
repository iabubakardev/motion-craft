// @ts-check
const FPS_VALUES = [24, 25, 30, 50, 60];
/** @param {number} fps */
function checkFPS(fps) {
  if (!FPS_VALUES.includes(fps)) throw new Error("Unsupported project FPS.");
}
/** @param {number} seconds @param {number} fps @param {'nearest'|'floor'|'ceil'} [rounding] */
function secondsToFrames(seconds, fps, rounding = "nearest") {
  checkFPS(fps);
  if (!Number.isFinite(seconds)) throw new Error("Time must be finite.");
  const value = seconds * fps;
  return rounding === "floor"
    ? Math.floor(value + 1e-7)
    : rounding === "ceil"
      ? Math.ceil(value - 1e-7)
      : Math.floor(value + 0.5 + 1e-7);
}
/** @param {number} frames @param {number} fps */
function framesToSeconds(frames, fps) {
  checkFPS(fps);
  if (!Number.isSafeInteger(frames)) throw new Error("Frames must be safe integers.");
  return frames / fps;
}
/** @param {number} frames @param {number} zoom @param {number} fps */
function framesToPixels(frames, zoom, fps) {
  if (!(zoom > 0) || !Number.isFinite(zoom)) throw new Error("Invalid zoom.");
  return framesToSeconds(frames, fps) * zoom;
}
/** @param {number} pixels @param {number} zoom @param {number} fps */
function pixelsToFrames(pixels, zoom, fps) {
  if (!(zoom > 0) || !Number.isFinite(zoom)) throw new Error("Invalid zoom.");
  return secondsToFrames(pixels / zoom, fps);
}
/** @param {number} frame @param {number} fps */
function formatTimecode(frame, fps) {
  checkFPS(fps);
  if (!Number.isSafeInteger(frame) || frame < 0) throw new Error("Invalid timecode frame.");
  const seconds = Math.floor(frame / fps);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60, frame % fps]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}
/** @param {string} text @param {number} fps */
function parseTimecode(text, fps) {
  checkFPS(fps);
  const match = /^(\d{2,}):(\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (!match) throw new Error("Use HH:MM:SS:FF timecode.");
  const [hours, minutes, seconds, frames] = match.slice(1).map(Number);
  if (minutes >= 60 || seconds >= 60 || frames >= fps || hours > 24)
    throw new Error("Timecode is outside its valid range.");
  const result = ((hours * 60 + minutes) * 60 + seconds) * fps + frames;
  if (result > 86400 * fps) throw new Error("Timeline exceeds 24 hours.");
  return result;
}
/** @param {import('../project/types').Project} project */
function timelineDurationFrames(project) {
  return secondsToFrames(project.duration, project.fps, "ceil");
}
module.exports = {
  secondsToFrames,
  framesToSeconds,
  framesToPixels,
  pixelsToFrames,
  formatTimecode,
  parseTimecode,
  timelineDurationFrames,
};
