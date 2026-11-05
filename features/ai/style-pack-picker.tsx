"use client";
import { useState } from "react";
import type { z } from "zod";
import { builtIns, stylePackSchema } from "@/core/assets/style-packs.cjs";
export type StylePack = z.infer<typeof stylePackSchema>;
export function StylePackPicker({
  value,
  onChange,
  disabled,
}: {
  value: StylePack | null;
  onChange: (pack: StylePack | null) => void;
  disabled: boolean;
}) {
  const [json, setJSON] = useState(""),
    [error, setError] = useState("");
  const choices =
    value && !builtIns.some((p) => p.id === value.id) ? [...builtIns, value] : builtIns;
  return (
    <fieldset disabled={disabled} className="space-y-2">
      <label>
        Style pack (optional)
        <select
          aria-label="AI style pack"
          className="editor-input w-full"
          value={value?.id || ""}
          onChange={(e) => onChange(choices.find((p) => p.id === e.target.value) || null)}
        >
          <option value="">Use project style only</option>
          {choices.map((pack) => (
            <option key={pack.id} value={pack.id}>
              {pack.name}
            </option>
          ))}
        </select>
      </label>
      {value && (
        <>
          <p>
            {value.visualPreferences.join(" · ")}. Default animation: {value.animationDefault}.
            Caption preset: none (current renderer).
          </p>
          <button
            type="button"
            className="editor-secondary"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(value, null, 2) + "\n"], { type: "application/json" }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = `${value.id}.style-pack.json`;
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            Export style pack JSON
          </button>
        </>
      )}
      <details>
        <summary>Import style pack JSON</summary>
        <textarea
          aria-label="Style pack JSON"
          rows={3}
          className="editor-input w-full"
          maxLength={16000}
          value={json}
          onChange={(e) => setJSON(e.target.value)}
        />
        <input
          type="file"
          aria-label="Upload style pack JSON"
          accept="application/json,.json"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 16000) {
              setError("Style pack exceeds 16 KB.");
              return;
            }
            try {
              setJSON(await file.text());
            } catch {
              setError("Unable to read style pack.");
            }
          }}
        />
        <button
          type="button"
          className="editor-secondary"
          onClick={() => {
            try {
              if (new TextEncoder().encode(json).length > 16000)
                throw new Error("Style pack exceeds 16 KB.");
              onChange(stylePackSchema.parse(JSON.parse(json)));
              setError("");
            } catch {
              setError(
                'Invalid style pack. Use version 1, supported animations and captionPreset "none".',
              );
            }
          }}
        >
          Validate and use style pack
        </button>
        {error && <p role="alert">{error}</p>}
      </details>
    </fieldset>
  );
}
