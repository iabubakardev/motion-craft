import type { z } from "zod";
import type { visualSchema } from "../core/timeline/visual-schema.cjs";
type VisualPreview = { id: string; visual: z.infer<typeof visualSchema> };
import type { Caption } from "../core/captions/presets.cjs";
import { captionForLayer } from "../core/captions/presets.cjs";
import { CaptionContent } from "./caption-content";
import { useMemo, useState, useEffect } from "react";
import {
  AbsoluteFill,
  Sequence,
  Img,
  OffthreadVideo,
  Html5Audio,
  useVideoConfig,
  useCurrentFrame,
  getRemotionEnvironment,
  cancelRender,
  delayRender,
  continueRender,
} from "remotion";
import type { CSSProperties } from "react";
import { pose } from "../core/animation/engine.cjs";
import { basePose } from "../core/animation/commands.cjs";
import { buildComposition } from "./input.cjs";
import type { RenderInput, CompositionClip } from "./types";

export function ProjectComposition({
  input,
  captionPreview,
  visualPreview,
}: {
  visualPreview?: VisualPreview | null;
  input: RenderInput;
  captionPreview?: { id: string; box: Caption["box"] } | null;
}) {
  const model = useMemo(() => buildComposition(input), [input]);
  const [fontHandle] = useState(() => delayRender("Waiting for caption fonts"));
  useEffect(() => {
    void document.fonts.ready
      .then(() => continueRender(fontHandle))
      .catch(() => cancelRender(new Error("Caption fonts could not load")));
  }, [fontHandle]);
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#000000",
        fontFamily: "Arial, sans-serif",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 1.2,
        color: "#ffffff",
        letterSpacing: "normal",
        textTransform: "none",
        boxSizing: "border-box",
      }}
    >
      <AbsoluteFill style={{ backgroundColor: model.background }} />
      {input.audioMix && <Html5Audio src={input.audioMix} volume={1} />}
      {model.clips
        .filter((clip) => !(clip.type === "audio" && (input.audioMix || input.audioPending)))
        .map((clip) => (
          <Sequence
            key={clip.id}
            name={clip.label}
            from={clip.from}
            durationInFrames={clip.durationInFrames}
            premountFor={fps}
          >
            <ClipContent
              clip={
                visualPreview?.id === clip.id ? { ...clip, visual: visualPreview.visual } : clip
              }
              captionPreview={captionPreview}
            />
          </Sequence>
        ))}
    </AbsoluteFill>
  );
}
function ClipContent({
  clip,
  captionPreview,
}: {
  clip: CompositionClip;
  captionPreview?: { id: string; box: Caption["box"] } | null;
}) {
  const [decodeFailed, setDecodeFailed] = useState(false);
  const onMediaError = (error: Error) => {
    if (getRemotionEnvironment().isRendering) cancelRender(error);
    else setDecodeFailed(true);
  };
  const { width, height, fps } = useVideoConfig(),
    frame = useCurrentFrame();
  const original = clip.layer;
  const layer =
    original?.type === "caption" && captionPreview?.id === original.id
      ? {
          ...original,
          properties: {
            ...original.properties,
            caption: { ...captionForLayer(original, { width, height }), box: captionPreview.box },
          },
        }
      : original;
  const transform = pose(clip.motion?.keyframes ?? [], basePose(layer, clip.visual), frame);
  const transition = clip.visual;
  const span = Math.min(clip.durationInFrames / 2, (transition?.transitionSeconds ?? 0) * fps);
  const entering = span ? Math.max(0, 1 - frame / span) : 0;
  const leaving = span ? Math.max(0, 1 - (clip.durationInFrames - 1 - frame) / span) : 0;
  const progress = transition?.entrance !== "none" ? entering : 0;
  const out = transition?.exit !== "none" ? leaving : 0;
  if (transition) {
    if (transition.entrance === "fade" || transition.exit === "fade")
      transform.opacity *=
        1 -
        Math.max(
          transition.entrance === "fade" ? progress : 0,
          transition.exit === "fade" ? out : 0,
        );
    transform.x +=
      (transition.entrance === "slide-left"
        ? width * progress
        : transition.entrance === "slide-right"
          ? -width * progress
          : 0) +
      (transition.exit === "slide-left"
        ? -width * out
        : transition.exit === "slide-right"
          ? width * out
          : 0);
    if (transition.entrance === "zoom" || transition.exit === "zoom") {
      const factor =
        1 -
        0.2 *
          Math.max(
            transition.entrance === "zoom" ? progress : 0,
            transition.exit === "zoom" ? out : 0,
          );
      transform.scaleX *= factor;
      transform.scaleY *= factor;
    }
  }
  const style: CSSProperties = {
    position: "absolute",
    width: "100%",
    height: "100%",
    opacity: transform.opacity,
    translate: `${transform.x}px ${transform.y}px`,
    scale: `${transform.scaleX} ${transform.scaleY}`,
    rotate: `${transform.rotation}deg`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  };
  if (layer?.type === "caption")
    return (
      <div
        style={{
          ...style,
          translate: `${transform.x - layer.position.x}px ${transform.y - layer.position.y}px`,
          rotate: `${transform.rotation - layer.rotation}deg`,
          opacity: layer.opacity ? transform.opacity / layer.opacity : 0,
        }}
        data-composition-clip={clip.id}
      >
        <CaptionContent
          layer={layer}
          duration={clip.durationInFrames}
          offsetFrames={clip.from - clip.startSeconds * fps}
          pages={clip.captionPages}
        />
      </div>
    );
  if (clip.type === "audio" && decodeFailed)
    return (
      <div
        role="status"
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          color: "white",
          background: "#301d1d",
          padding: 8,
          fontSize: 14,
        }}
      >
        Audio preview cannot decode {clip.label}. Try a supported codec.
      </div>
    );
  if (clip.type === "audio")
    return clip.src && !decodeFailed ? (
      <Html5Audio
        src={clip.src}
        trimBefore={clip.sourceStart}
        playbackRate={clip.playbackRate}
        volume={(localFrame) =>
          clip.muted
            ? 0
            : clip.volume *
              Math.min(
                1,
                clip.fadeIn ? localFrame / (fps * clip.fadeIn) : 1,
                clip.fadeOut
                  ? Math.max(0, (clip.durationInFrames - 1 - localFrame) / (fps * clip.fadeOut))
                  : 1,
              )
        }
        onError={onMediaError}
      />
    ) : null;
  let content;
  if (decodeFailed)
    content = (
      <div
        role="status"
        style={{ background: "#301d1d", color: "white", padding: 16, fontSize: 16 }}
      >
        Preview decoder cannot play {clip.label}. Try a supported codec. FFmpeg export uses a
        separate decoder.
      </div>
    );
  else if (clip.assetId && !clip.src)
    content = (
      <div style={{ background: "#301d1d", color: "white", padding: 24 }}>
        Missing media: {clip.label}
      </div>
    );
  else if (clip.type === "video" && clip.src)
    content = (
      <OffthreadVideo
        src={clip.src}
        trimBefore={clip.sourceStart}
        playbackRate={clip.playbackRate}
        volume={clip.volume}
        muted={clip.muted}
        crossOrigin="anonymous"
        onError={onMediaError}
        style={{
          width: "100%",
          height: "100%",
          objectFit:
            clip.visual?.fit ??
            (layer?.type === "video" ? layer.properties.fit || "contain" : "contain"),
        }}
      />
    );
  else if (clip.type === "image" && clip.src)
    content = (
      <Img
        src={clip.src}
        onError={() => onMediaError(new Error("Image could not be decoded"))}
        style={{
          width: "100%",
          height: "100%",
          objectFit:
            clip.visual?.fit ?? (layer?.type === "image" ? layer.properties.fit : "contain"),
        }}
      />
    );
  else if (layer?.type === "text")
    content = (
      <div
        style={{
          fontSize: layer.properties.fontSize,
          fontFamily:
            layer.properties.fontFamily === "system"
              ? "Arial, sans-serif"
              : layer.properties.fontFamily,
          color: layer.properties.color,
          whiteSpace: "pre-wrap",
          textAlign: "center",
          overflowWrap: "anywhere",
        }}
      >
        {layer.properties.text}
      </div>
    );
  else if (layer?.type === "shape")
    content = (
      <div
        style={{
          width: width / 3,
          height: height / 3,
          boxSizing: "border-box",
          borderRadius: layer.properties.shape === "ellipse" ? "50%" : 0,
          backgroundColor: layer.properties.fill,
          border: `${layer.properties.strokeWidth}px solid ${layer.properties.stroke}`,
        }}
      />
    );
  return (
    <div style={style} data-composition-clip={clip.id}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          transform: `scale(${clip.visual?.flipX ? -1 : 1},${clip.visual?.flipY ? -1 : 1})`,
          clipPath: clip.visual
            ? `inset(${clip.visual.crop.top * 100}% ${clip.visual.crop.right * 100}% ${clip.visual.crop.bottom * 100}% ${clip.visual.crop.left * 100}%)`
            : undefined,
        }}
      >
        {content}
      </div>
    </div>
  );
}
