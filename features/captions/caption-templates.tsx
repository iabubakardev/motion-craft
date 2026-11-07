"use client";
import type { Caption } from "@/core/captions/presets.cjs";
import { makeCaption } from "@/core/captions/presets.cjs";
import { presetSchema } from "@/core/captions/schema.cjs";
const descriptions: Record<Caption["preset"], string> = {
  documentary: "Clean lower-third text",
  "bold-impact": "Bold outline and pop",
  "karaoke-highlight": "Highlight spoken words",
  "rounded-box": "Color box and slide",
  cinematic: "Serif text and soft fade",
  "word-pop": "Short groups with bounce",
};
export function CaptionTemplates({
  disabled,
  selected,
  onApply,
}: {
  disabled: boolean;
  selected?: Caption["preset"];
  onApply: (preset: Caption["preset"]) => void;
}) {
  return (
    <section aria-label="Caption templates" className="space-y-2">
      <h4 className="font-semibold">Caption templates</h4>
      <div className="grid grid-cols-2 gap-2">
        {presetSchema.options.map((preset) => {
          const s = makeCaption(preset).style,
            name = preset
              .split("-")
              .map((w) => w[0].toUpperCase() + w.slice(1))
              .join(" ");
          return (
            <button
              key={preset}
              type="button"
              aria-label={`Apply ${name} caption template`}
              aria-pressed={selected === preset}
              disabled={disabled}
              title={disabled ? "Generate or select editable captions first" : `Apply ${name}`}
              onClick={() => onApply(preset)}
              className={`min-w-0 rounded border p-2 text-left hover:border-cyan-300 focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:opacity-50 ${selected === preset ? "border-cyan-300" : "border-[var(--editor-border)]"}`}
            >
              <div
                aria-hidden
                className="mb-2 flex min-h-12 items-center justify-center overflow-hidden rounded bg-[#101014] px-1 text-center"
                style={{
                  fontFamily: s.fontFamily,
                  fontWeight: s.fontWeight,
                  color: s.color,
                  textTransform: s.casing,
                  letterSpacing: preset === "cinematic" ? 1 : 0,
                  textShadow: s.outlineWidth ? "1px 1px #000, -1px -1px #000" : "0 1px 3px #000",
                }}
              >
                <span
                  style={{
                    background: s.backgroundOpacity ? s.backgroundColor : undefined,
                    borderRadius: preset === "rounded-box" ? 6 : 0,
                    padding: s.backgroundOpacity ? 4 : 0,
                  }}
                >
                  Your{" "}
                  <span
                    style={{ color: preset === "karaoke-highlight" ? s.activeColor : undefined }}
                  >
                    captions
                  </span>
                </span>
              </div>
              <span className="block text-[11px] font-medium">{name}</span>
              <span className="block text-[10px] text-[var(--editor-muted)]">
                {descriptions[preset]}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
