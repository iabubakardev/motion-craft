import type { ProjectDocumentController } from "@/features/projects/use-project-document";

export function LayerProperties({ document: doc }: { document: ProjectDocumentController }) {
  const layer = doc.selectedLayer;
  if (!layer) return null;
  return (
    <fieldset disabled={doc.busy} className="min-w-0 border-t border-[var(--editor-border)] p-4">
      <h3 className="text-xs font-medium capitalize">{layer.type} layer</h3>
      <p className="mt-2 text-[10px] leading-5 text-[var(--editor-muted)]">
        Base transforms apply when a property has no keyframes. Edit animated values in Animation
        below.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {(
          [
            ["Position X", layer.position.x, -100000, 100000, 1],
            ["Position Y", layer.position.y, -100000, 100000, 1],
            ["Scale", layer.scale, 0.01, 100, 0.01],
            ["Rotation", layer.rotation, -36000, 36000, 1],
            ["Opacity", layer.opacity, 0, 1, 0.01],
            ["Start", layer.start, 0, 86400, 0.1],
            ["Duration", layer.duration, 0.01, 86400, 0.1],
          ] as const
        ).map(([label, value, min, max, step]) => (
          <label
            key={`${layer.id}:${label}:${value}`}
            className="text-[10px] text-[var(--editor-muted)]"
          >
            {label}
            <input
              aria-label={`Layer ${label.toLowerCase()}`}
              className="editor-input mt-1 w-full"
              type="number"
              min={min}
              max={max}
              step={step}
              defaultValue={value}
              onBlur={(event) => {
                const numeric = Number(event.target.value);
                if (numeric === value) return;
                const patch =
                  label === "Position X"
                    ? { position: { ...layer.position, x: numeric } }
                    : label === "Position Y"
                      ? { position: { ...layer.position, y: numeric } }
                      : { [label.toLowerCase()]: numeric };
                if (!doc.updateLayer(layer.id, patch)) event.target.value = String(value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </label>
        ))}
      </div>
      {(layer.type === "text" || layer.type === "caption") && (
        <label className="mt-3 block text-[10px] text-[var(--editor-muted)]">
          Text
          <textarea
            aria-label="Layer text"
            key={`${layer.id}:${layer.properties.text}`}
            defaultValue={layer.properties.text}
            maxLength={10000}
            rows={3}
            className="editor-input mt-1 w-full"
            onBlur={(event) => doc.updateLayer(layer.id, { text: event.target.value })}
          />
        </label>
      )}
    </fieldset>
  );
}
