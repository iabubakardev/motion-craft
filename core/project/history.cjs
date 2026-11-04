const { serializeProject } = require("./schema.cjs");

/** @param {import('./types').Project} project @returns {import('./types').ProjectHistory} */
function createHistory(project) { return { present: project, past: [], future: [], savedJSON: serializeProject(project) }; }
/** @param {import('./types').ProjectHistory} history @param {import('./types').Project} project */
function commitProject(history, project) {
  if (serializeProject(history.present) === serializeProject(project)) return history;
  return { ...history, present: project, past: [...history.past.slice(-49), history.present], future: [] };
}
/** @param {import('./types').ProjectHistory} history */
function undoProject(history) {
  if (!history.past.length) return history;
  return { ...history, present: history.past[history.past.length - 1], past: history.past.slice(0, -1), future: [history.present, ...history.future] };
}
/** @param {import('./types').ProjectHistory} history */
function redoProject(history) {
  if (!history.future.length) return history;
  return { ...history, present: history.future[0], past: [...history.past, history.present], future: history.future.slice(1) };
}

module.exports = { createHistory, commitProject, undoProject, redoProject };
