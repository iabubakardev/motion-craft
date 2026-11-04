"use client";

import { useRef, useState } from "react";

export function PanelResizeHandle({ label, controls, orientation = "vertical", value, min, max, reverse = false, onResize, onReset }: {
  label: string; controls: string; orientation?: "vertical" | "horizontal";
  value: number; min: number; max: number; reverse?: boolean;
  onResize: (value: number) => void; onReset: () => void;
}) {
  const drag = useRef<{ start: number; value: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const coordinate = (event: React.PointerEvent) => orientation === "vertical" ? event.clientX : event.clientY;
  return (
    <div role="separator" tabIndex={0} aria-label={label} aria-controls={controls} aria-orientation={orientation}
      aria-valuenow={Math.round(value)} aria-valuemin={min} aria-valuemax={Math.round(max)} aria-valuetext={`${Math.round(value)} pixels`}
      title="Drag or use arrow keys to resize. Double-click or press Home to reset."
      className={`panel-resize-handle ${orientation} ${dragging ? "dragging" : ""}`}
      onDoubleClick={onReset}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { start: coordinate(event), value };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (drag.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
          const delta = (coordinate(event) - drag.current.start) * (reverse ? -1 : 1);
          onResize(Math.max(min, Math.min(max, drag.current.value + delta)));
        }
      }}
      onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
      onKeyDown={(event) => {
        if (event.key === "Home") { event.preventDefault(); onReset(); return; }
        if (event.key === "End") { event.preventDefault(); onResize(max); return; }
        const negative = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
        const positive = orientation === "vertical" ? "ArrowRight" : "ArrowDown";
        if (event.key !== negative && event.key !== positive) return;
        event.preventDefault();
        const delta = (event.key === negative ? -1 : 1) * (reverse ? -1 : 1) * (event.shiftKey ? 50 : 10);
        onResize(Math.max(min, Math.min(max, value + delta)));
      }}
    ><span /></div>
  );
}
