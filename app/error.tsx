"use client";

import { useEffect } from "react";

export default function WorkspaceError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error("[workspace] Unexpected rendering failure", error);
  }, [error]);

  return (
    <main
      role="alert"
      className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#11151c] px-6 text-center text-[#f3f6fa]"
    >
      <h1 className="text-xl font-semibold">The workspace encountered an error</h1>
      <p className="max-w-md text-sm leading-6 text-[#a1adbb]">
        Saved project files remain available. Retrying may reset unsaved edits; no automatic
        recovery is available yet.
      </p>
      <button
        type="button"
        onClick={retry}
        className="rounded bg-[#42c8dd] px-4 py-2 text-sm font-medium text-[#11151c] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#42c8dd]"
      >
        Retry workspace
      </button>
    </main>
  );
}
