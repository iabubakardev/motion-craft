// @ts-check
const path = require("node:path");
const fs = require("node:fs/promises");
const { fork, execFile } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { jobSchema, workerRequestSchema, workerEventSchema } = require("../rendering/contracts.cjs");
/** @typedef {import('zod').infer<typeof jobSchema>} Job */
/** @param {import('node:child_process').ChildProcess} child */
function killTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32")
    execFile(
      path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"),
      ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true },
      () => {},
    );
  else child.kill("SIGKILL");
}
/** @param {(options:import("node:child_process").ForkOptions & {windowsHide:boolean})=>import("node:child_process").ChildProcess} [launch] */
function createRenderJobs(
  launch = (options) => fork(path.join(__dirname, "../workers/render.cjs"), [], options),
) {
  /** @type {{job:Job,owner:number,child:import('node:child_process').ChildProcess,partial:string,output:string,before:import('node:fs').Stats|null,cancelling:boolean,finishing:boolean,terminal:boolean,timer?:ReturnType<typeof setTimeout>}|null} */
  let active = null;
  /** @type {{job:Job,owner:number}|null} */ let latest = null;
  /** @param {number} owner */
  function status(owner) {
    return latest?.owner === owner ? jobSchema.parse(latest.job) : null;
  }
  /** @param {number} owner @param {import('zod').infer<typeof workerRequestSchema>} request @param {import("node:fs").Stats|null} expected */
  async function start(owner, request, expected) {
    if (active) throw new Error("Another export is already in progress.");
    workerRequestSchema.parse(request);
    const before = await fs.stat(request.output).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (
      !before !== !expected ||
      (before &&
        expected &&
        (before.ino !== expected.ino ||
          before.mtimeMs !== expected.mtimeMs ||
          before.size !== expected.size))
    )
      throw new Error("Destination changed while confirming export.");
    if (before && !before.isFile()) throw new Error("Select a regular output file.");
    if (active) throw new Error("Another export is already in progress.");
    const id = randomUUID(),
      partial = path.join(path.dirname(request.output), `.motioncraft-${id}.partial.mp4`);
    /** @type {import("node:child_process").ForkOptions & {windowsHide:boolean}} */
    const options = {
      execPath: process.execPath,
      execArgv: [],
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    };
    const child = launch(options);
    const context = {
      job: jobSchema.parse({
        id,
        state: "preparing",
        progress: 0,
        filename: path.basename(request.output),
        message: "Preparing local render",
      }),
      owner,
      child,
      partial,
      output: request.output,
      before,
      cancelling: false,
      finishing: false,
      terminal: false,
      ...{ timer: undefined /** @type {ReturnType<typeof setTimeout>|undefined} */ },
    };
    active = context;
    latest = context;
    child.stdout?.resume();
    child.stderr?.on("data", (data) => console.error("[render]", String(data)));
    /** @param {'completed'|'failed'|'cancelled'} state @param {string} message */
    async function finish(state, message) {
      if (context.terminal) return;
      context.terminal = true;
      clearTimeout(context.timer);
      await fs.unlink(partial).catch(() => {});
      context.job = {
        ...context.job,
        state,
        message,
        progress: state === "completed" ? 1 : context.job.progress,
      };
      if (active === context) active = null;
    }
    child.on("message", async (raw) => {
      const parsed = workerEventSchema.safeParse(raw);
      if (!parsed.success || context.terminal) return;
      const event = parsed.data;
      if (event.type === "progress") {
        if (!context.cancelling)
          context.job = {
            ...context.job,
            state: event.state,
            progress: event.progress,
            message: event.state,
          };
        return;
      }
      if (event.type === "done") {
        if (context.cancelling) {
          await finish("cancelled", "Export cancelled. Existing output was kept.");
          return;
        }
        context.finishing = true;
        context.job = { ...context.job, state: "finalizing", message: "Committing verified MP4" };
        try {
          const current = await fs.stat(context.output).catch((error) => {
            if (error.code === "ENOENT") return null;
            throw error;
          });
          if (
            !context.before !== !current ||
            (context.before &&
              current &&
              (context.before.ino !== current.ino ||
                context.before.mtimeMs !== current.mtimeMs ||
                context.before.size !== current.size))
          )
            throw new Error("Destination changed");
          const file = await fs.open(partial, "r+");
          try {
            await file.sync();
          } finally {
            await file.close();
          }
          await fs.rename(partial, context.output);
          await finish("completed", "Verified H.264 MP4 export completed.");
        } catch {
          await finish(
            "failed",
            "Could not commit output. The destination changed or is inaccessible; the prior file was kept.",
          );
        }
      } else
        await finish(
          event.type === "cancelled" ? "cancelled" : "failed",
          event.type === "failed" ? event.message : "Export cancelled. Existing output was kept.",
        );
    });
    child.once("error", () => {
      void finish("failed", "The rendering worker could not start.");
    });
    child.once("exit", () => {
      if (!context.terminal && !context.finishing)
        void finish(
          context.cancelling ? "cancelled" : "failed",
          context.cancelling ? "Export cancelled." : "Rendering worker exited unexpectedly.",
        );
    });
    child.send({ ...request, output: partial });
    return status(owner);
  }
  /** @param {number} owner @param {string} id */
  function cancel(owner, id) {
    if (!active || active.owner !== owner || active.job.id !== id) return status(owner);
    if (active.finishing || active.cancelling) return status(owner);
    active.cancelling = true;
    active.job = { ...active.job, state: "cancelling", message: "Cancelling local render" };
    active.child.send({ cancel: true });
    const context = active;
    context.timer = setTimeout(() => {
      killTree(context.child);
    }, 10000);
    return status(owner);
  }
  /** @param {number} owner */ function release(owner) {
    if (active?.owner === owner) cancel(owner, active.job.id);
  }
  function dispose() {
    if (active) killTree(active.child);
  }
  return { start, status, cancel, release, dispose, isBusy: () => !!active };
}
module.exports = { createRenderJobs, killTree };
