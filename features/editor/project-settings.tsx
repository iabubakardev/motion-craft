"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { aspectRatioSchema, fpsSchema } from "@/core/project/schema.cjs";
import type { ProjectPlaceholder } from "./types";

const settingsSchema = z.object({ name: z.string().min(1).max(120).refine(value => !!value.trim()), width: z.number().int().min(64).max(8192), height: z.number().int().min(64).max(8192), fps: fpsSchema, aspectRatio: aspectRatioSchema }).superRefine((value, ctx) => {
  const ratio = { '16:9':16/9, '9:16':9/16, '1:1':1, '4:3':4/3 }[value.aspectRatio];
  if (Math.abs(value.width/value.height-ratio)>0.002) ctx.addIssue({code:'custom',path:['aspectRatio'],message:'Aspect ratio must match canvas dimensions.'});
});

export function ProjectSettings({ project, onApply, onClose }: { project: ProjectPlaceholder; onApply: (project: ProjectPlaceholder) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} aria-labelledby="settings-title" onCancel={(event) => { event.preventDefault(); onClose(); }} className="project-settings-dialog">
    <form onSubmit={(event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      const parsed = settingsSchema.safeParse({ name:form.get('name'), width:Number(form.get('width')), height:Number(form.get('height')), fps:Number(form.get('fps')), aspectRatio:form.get('aspectRatio') });
      if (!parsed.success) { setError(parsed.error.issues.map(issue => issue.message).join(' ')); return; }
      onApply(parsed.data); onClose();
    }}>
      <h2 id="settings-title" className="text-sm font-semibold">Project settings</h2><p className="mt-2 text-xs leading-5 text-[var(--editor-muted)]">Edit project data, then save to keep changes. Composition rendering is not integrated yet.</p>
      <label className="mt-5 block text-xs">Project name<input autoFocus required maxLength={120} name="name" defaultValue={project.name} className="editor-input mt-2 w-full" /></label>
      <div className="mt-4 grid grid-cols-2 gap-4"><label className="text-xs">Width<input required type="number" name="width" min={64} max={8192} defaultValue={project.width} className="editor-input mt-2 w-full" /></label><label className="text-xs">Height<input required type="number" name="height" min={64} max={8192} defaultValue={project.height} className="editor-input mt-2 w-full" /></label><label className="text-xs">Aspect ratio<select name="aspectRatio" defaultValue={project.aspectRatio || '16:9'} className="editor-input mt-2 w-full">{['16:9','9:16','1:1','4:3'].map(ratio => <option key={ratio}>{ratio}</option>)}</select></label><label className="text-xs">Frame rate<select name="fps" defaultValue={project.fps} className="editor-input mt-2 w-full">{[24,25,30,50,60].map(fps => <option key={fps} value={fps}>{fps} fps</option>)}</select></label></div>
      {error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}
      <div className="mt-6 flex justify-end gap-2"><button type="button" className="editor-secondary" onClick={onClose}>Cancel</button><button type="submit" className="editor-primary">Apply settings</button></div>
    </form>
  </dialog>;
}
