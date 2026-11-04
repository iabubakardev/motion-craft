"use client";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export function ConfirmDialog({ title, children, confirmLabel, busy = false, onConfirm, onCancel }: {
  title: string; children: ReactNode; confirmLabel: string; busy?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} aria-label={title} onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }} className="project-settings-dialog">
    <h2 className="text-sm font-semibold">{title}</h2><div className="my-4 text-xs leading-6 text-[var(--editor-muted)]">{children}</div>
    <div className="flex justify-end gap-2"><button type="button" autoFocus disabled={busy} className="editor-secondary" onClick={onCancel}>Cancel</button><button type="button" disabled={busy} className="editor-primary" onClick={onConfirm}>{busy ? "Working…" : confirmLabel}</button></div>
  </dialog>;
}
