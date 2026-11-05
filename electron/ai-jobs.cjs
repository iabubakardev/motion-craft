// @ts-check
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { launchWorker, killTree } = require("./child-process.cjs");
const { requestSchema, jobSchema, eventSchema } = require("../core/ai/schema.cjs");
/** @typedef {import('zod').infer<typeof jobSchema>} Job */
/** @param {(entry:string)=>import('node:child_process').ChildProcess} [launch] */
function createAIJobs(launch = launchWorker) {
  /** @type {{owner:number,job:Job,child:import('node:child_process').ChildProcess,timer:ReturnType<typeof setTimeout>,terminal:boolean}|null} */
  let active = null;
  /** @type {{owner:number,job:Job}|null} */ let latest = null;
  /** @param {number} owner */
  const status = (owner) => (latest?.owner === owner ? jobSchema.parse(latest.job) : null);
  /** @param {number} owner @param {unknown} raw @param {unknown} binding @param {unknown} [assetContext] */
  function start(owner, raw, binding, assetContext = null) {
    const request = requestSchema.parse(raw);
    if (active) throw new Error("Another AI task is in progress.");
    const child = launch(path.join(__dirname, "../workers/ai.cjs"));
    const context = {
      owner,
      child,
      job: jobSchema.parse({
        id: randomUUID(),
        state: "preparing",
        stage: "Preparing local AI",
        progress: null,
        error: null,
        result: null,
      }),
      terminal: false,
      timer: setTimeout(
        () => finish("failed", "Local AI timed out. Try a smaller input or model.", "timeout"),
        request.kind === "detect" ? 30000 : 30 * 60 * 1000,
      ),
    };
    active = context;
    latest = context;
    /** @param {'failed'|'cancelled'|'completed'} state @param {string} stage @param {Job['error']} [error] */
    function finish(state, stage, error = null) {
      if (context.terminal) return;
      context.terminal = true;
      clearTimeout(context.timer);
      context.job = {
        ...context.job,
        state,
        stage,
        error,
        progress: state === "completed" ? 1 : null,
      };
      killTree(child);
      if (active === context) active = null;
    }
    child.stdout?.resume();
    child.stderr?.resume();
    child.on("message", (raw) => {
      if (context.terminal || context.job.state === "cancelling") return;
      const result = eventSchema.safeParse(raw);
      if (!result.success) {
        finish("failed", "AI worker returned an invalid message.", "invalid-output");
        return;
      }
      const event = result.data;
      if (event.type === "progress")
        context.job = {
          ...context.job,
          state: event.state,
          stage: event.stage,
          progress: event.progress,
        };
      else if (event.type === "error") finish("failed", event.message, event.code);
      else {
        const expected =
          request.kind === "detect"
            ? "runtime"
            : request.kind === "transcribe"
              ? "transcript"
              : request.kind === "assets"
                ? "assets"
                : "plan";
        if (event.result.kind !== expected) {
          finish("failed", "AI worker returned the wrong result type.", "invalid-output");
          return;
        }
        context.job = { ...context.job, result: event.result };
        finish("completed", "Local result ready for review");
      }
    });
    child.on("error", () =>
      finish("failed", "Unable to launch the local AI worker.", "worker-failed"),
    );
    child.on("exit", () => {
      if (!context.terminal)
        if (context.job.state === "cancelling") finish("cancelled", "Local AI cancelled");
        else finish("failed", "Local AI worker exited before completing.", "worker-failed");
    });
    child.send({ id: context.job.id, request, binding, assetContext }, (error) => {
      if (error) finish("failed", "Unable to start the AI worker.", "worker-failed");
    });
    return context.job;
  }
  /** @param {number} owner @param {string} id */
  function cancel(owner, id) {
    if (active?.owner === owner && active.job.id === id) {
      const context = active;
      context.job = {
        ...context.job,
        state: "cancelling",
        stage: "Cancelling local AI",
        result: null,
      };
      clearTimeout(context.timer);
      killTree(context.child);
      // Keep the slot occupied until the child has actually exited.
    }
    return status(owner);
  }
  /** @param {number} owner */
  function release(owner) {
    if (active?.owner === owner) cancel(owner, active.job.id);
    if (latest?.owner === owner) latest = null;
  }
  return { start, status, cancel, release, isBusy: () => !!active };
}
module.exports = { createAIJobs };
