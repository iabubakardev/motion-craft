import { useCurrentFrame, useVideoConfig } from "remotion";
import { Fragment } from "react";
import type { CSSProperties } from "react";
import type { Layer } from "../core/project/types";
import { captionForLayer } from "../core/captions/presets.cjs";
import { captionFrame, revealText, captionWordWindow } from "../core/captions/engine.cjs";

export function CaptionContent({
  layer,
  duration,
  offsetFrames,
  pages,
}: {
  layer: Extract<Layer, { type: "caption" }>;
  duration: number;
  offsetFrames: number;
  pages: { start: number; end: number }[];
}) {
  const { width, height, fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const caption = captionForLayer(layer, { width, height }),
    { style: s, box } = caption;
  const animation = captionFrame(caption, frame + offsetFrames, fps, duration);
  const fontSize = s.fontSize * height;
  const boxHeight = (s.maxLines * s.fontSize * s.lineHeight + 2 * s.padding) * height;
  const textStyle: CSSProperties = {
    fontFamily: `${s.fontFamily}, ${s.fontFamily === "Georgia" ? "serif" : "sans-serif"}`,
    fontSize,
    fontWeight: s.fontWeight,
    color: s.color,
    textAlign: s.align,
    textTransform: s.casing,
    letterSpacing: s.letterSpacing * height,
    lineHeight: s.lineHeight,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    WebkitTextStroke: `${s.outlineWidth * height}px ${s.outlineColor}`,
    paintOrder: "stroke fill",
    textShadow: `${s.shadowX * height}px ${s.shadowY * height}px ${s.shadowBlur * height}px ${s.shadowColor}`,
    width: "100%",
    display: "-webkit-box",
    WebkitLineClamp: s.maxLines,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  };
  const useWords = caption.words.length > 0;
  const wordWindow = captionWordWindow(
    s.displayMode || "full",
    animation.active,
    pages,
    caption.words.length,
  );
  const parts = (() => {
    let cursor = 0;
    return caption.words.map((word, index) => {
      const text = word.text.trim(),
        at = layer.properties.text.indexOf(text, cursor);
      const separator = index ? (at >= cursor ? layer.properties.text.slice(cursor, at) : " ") : "";
      if (at >= 0) cursor = at + text.length;
      return { word, separator };
    });
  })();
  if (useWords && wordWindow.start === wordWindow.end) return null;
  return (
    <div
      data-caption-id={layer.id}
      data-caption-preset={caption.preset}
      style={{
        position: "absolute",
        left: box.x * width,
        top: (box.y + animation.slide) * height,
        width: box.width * width,
        height: boxHeight,
        transform: `translate(-50%, -50%) rotate(${box.rotation}deg) scale(${animation.scale})`,
        opacity: s.opacity * animation.opacity,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        padding: s.padding * height,
      }}
    >
      <div
        style={{
          ...textStyle,
          backgroundColor: `${s.backgroundColor}${Math.round(s.backgroundOpacity * 255)
            .toString(16)
            .padStart(2, "0")}`,
          borderRadius: s.radius * height,
          padding: s.backgroundOpacity ? s.padding * height : 0,
        }}
      >
        {useWords
          ? parts.map(({ word, separator }, index) => {
              if (index < wordWindow.start || index >= wordWindow.end) return null;
              const active = index === animation.active;
              return (
                <Fragment key={index}>
                  {index === wordWindow.start ? "" : separator}
                  <span
                    data-caption-word={index}
                    data-active={active}
                    style={{
                      display: "inline-block",
                      whiteSpace: "pre-wrap",
                      maxWidth: "100%",
                      marginInlineEnd: index < caption.words.length - 1 ? "0.2em" : 0,
                      visibility:
                        s.animation === "reveal" && animation.time < word.start
                          ? "hidden"
                          : "visible",
                      color:
                        word.color ||
                        (s.animation === "karaoke"
                          ? active
                            ? s.activeColor
                            : s.inactiveColor
                          : s.color),
                      fontWeight: word.bold ? 900 : s.fontWeight,
                      transform: `scale(${(word.scale || 1) * (active ? s.activeScale : 1)})`,
                    }}
                  >
                    {word.text.trim()}
                  </span>
                </Fragment>
              );
            })
          : s.animation === "reveal"
            ? revealText(layer.properties.text, frame + offsetFrames, fps, s.animationSeconds)
            : layer.properties.text}
      </div>
    </div>
  );
}
