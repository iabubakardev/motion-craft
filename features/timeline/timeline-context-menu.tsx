"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { EditorIcon } from "@/features/editor/editor-icon";
import type { EditorIconName } from "@/features/editor/editor-icon";
interface Item {
  label: string;
  icon?: EditorIconName;
  shortcut?: string;
  disabled?: boolean;
  run: () => void;
}
export function TimelineContextMenu({
  x,
  y,
  valid,
  items,
  onClose,
}: {
  valid: boolean;
  x: number;
  y: number;
  items: Item[];
  onClose: (restore: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const fit = () => {
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0,
        top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? document.documentElement.clientWidth,
        height = viewport?.height ?? window.innerHeight;
      element.style.maxWidth = `${Math.max(0, width - 8)}px`;
      element.style.maxHeight = `${Math.max(0, height - 8)}px`;
      const rect = element.getBoundingClientRect();
      element.style.left = `${Math.max(left + 4, Math.min(x, left + width - rect.width - 4))}px`;
      element.style.top = `${Math.max(top + 4, Math.min(y, top + height - rect.height - 4))}px`;
    };
    fit();
    element
      .querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("scroll", fit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("scroll", fit);
    };
  }, [x, y]);
  useLayoutEffect(() => {
    if (!valid) onClose(false);
  }, [valid, onClose]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) onClose(false);
    };
    const dismiss = () => onClose(false);
    const scroll = (event: Event) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return;
      dismiss();
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", dismiss);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [onClose]);
  if (!valid) return null;
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Timeline context menu"
      className="fixed z-[100] w-64 min-w-0 overflow-y-auto overscroll-contain rounded border p-1 text-xs shadow-xl"
      style={{
        left: x,
        top: y,
        backgroundColor: "var(--editor-panel, #1b222c)",
        color: "var(--editor-text, #f3f6fa)",
        borderColor: "var(--editor-border, #303946)",
        maxWidth: "calc(100vw - 8px)",
        maxHeight: "calc(100dvh - 8px)",
      }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onClose(true);
          return;
        }
        if (event.key === "Tab") {
          onClose(false);
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const buttons = Array.from(
          ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || [],
        );
        if (!buttons.length) return;
        const index = buttons.findIndex((button) => button === document.activeElement);
        buttons[
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length
        ].focus();
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          className="flex w-full min-w-0 items-center gap-2 rounded px-3 py-2 text-left hover:bg-[var(--editor-elevated,#29313d)] focus:bg-[var(--editor-elevated,#29313d)] focus:outline-none disabled:opacity-40"
          onClick={() => {
            item.run();
            onClose(true);
          }}
        >
          {item.icon ? (
            <EditorIcon name={item.icon} className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1 [overflow-wrap:anywhere]">
            <span>{item.label}</span>
            {item.shortcut && (
              <kbd className="text-[10px]" style={{ color: "var(--editor-muted, #a1adbb)" }}>
                {item.shortcut}
              </kbd>
            )}
          </span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
