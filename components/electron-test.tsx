"use client";

import { useState } from "react";

type TestResult =
  | { status: "idle" | "loading" | "unavailable" }
  | { status: "success"; version: string }
  | { status: "error"; message: string };

export default function ElectronTest() {
  const [result, setResult] = useState<TestResult>({ status: "idle" });

  async function testConnection() {
    setResult({ status: "loading" });
    try {
      const bridge = window.motioncraft;
      if (!bridge) {
        setResult({ status: "unavailable" });
        return;
      }
      const version = await bridge.getAppVersion();
      if (typeof version !== "string" || !version.trim()) {
        throw new Error("The main process returned an invalid app version.");
      }
      setResult({ status: "success", version });
    } catch (error) {
      setResult({
        status: "error",
        message: error instanceof Error ? error.message : "The IPC request failed.",
      });
    }
  }

  return (
    <section aria-labelledby="electron-test-title" className="w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900 p-8 shadow-xl">
      <p className="text-sm font-medium tracking-widest text-violet-400">MOTION CRAFT</p>
      <h1 id="electron-test-title" className="mt-3 text-3xl font-semibold tracking-tight">Electron connection test</h1>
      <p className="mt-4 leading-7 text-zinc-400">
        Request the app version through the preload bridge to check communication with the Electron main process.
      </p>
      <button
        type="button"
        onClick={testConnection}
        disabled={result.status === "loading"}
        className="mt-8 rounded-lg bg-violet-500 px-5 py-3 font-medium text-white transition hover:bg-violet-400 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-400 disabled:cursor-wait disabled:opacity-60"
      >
        {result.status === "loading" ? "Testing connection…" : "Test Electron connection"}
      </button>
      <div role="status" aria-live="polite" aria-atomic="true" className="mt-6 rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm leading-6">
        {result.status === "idle" && <p className="text-zinc-400">Ready to test. Open this page in the Electron window.</p>}
        {result.status === "loading" && <p className="text-zinc-400">Waiting for the main process…</p>}
        {result.status === "success" && (
          <div className="text-emerald-400">
            <p className="font-medium">Connected successfully</p>
            <p>App version: <span className="font-mono">{result.version}</span></p>
          </div>
        )}
        {result.status === "unavailable" && (
          <div className="text-amber-300">
            <p className="font-medium">Electron bridge unavailable</p>
            <p>In a browser, this is expected. Run <code>npm run dev:desktop</code> and test in the desktop window. If already in Electron, check that the preload script loaded.</p>
          </div>
        )}
        {result.status === "error" && (
          <div className="text-red-400">
            <p className="font-medium">Connection failed</p>
            <p>{result.message}</p>
          </div>
        )}
      </div>
    </section>
  );
}
