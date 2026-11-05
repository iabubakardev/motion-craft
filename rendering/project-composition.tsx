import { useMemo, useState } from "react";
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
} from "remotion";
import type { CSSProperties } from "react";
import { pose } from "../core/animation/engine.cjs";
import { basePose } from "../core/animation/commands.cjs";
import { buildComposition } from "./input.cjs";
import type { RenderInput, CompositionClip } from "./types";

export function ProjectComposition({ input }: { input: RenderInput }) {
  const model = useMemo(() => buildComposition(input), [input]);
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
      {model.clips.map((clip) => (
        <Sequence
          key={clip.id}
          name={clip.label}
          from={clip.from}
          durationInFrames={clip.durationInFrames}
          premountFor={fps}
        >
          <ClipContent clip={clip} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
function ClipContent({ clip }: { clip: CompositionClip }) {
  const [decodeFailed, setDecodeFailed] = useState(false);
  const onMediaError = (error: Error) => {
    if (getRemotionEnvironment().isRendering) cancelRender(error);
    else setDecodeFailed(true);
  };
  const { width, height } = useVideoConfig(),
    frame = useCurrentFrame();
  const layer = clip.layer;
  const transform = pose(clip.motion?.keyframes ?? [], basePose(layer), frame);
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
        volume={clip.muted ? 0 : clip.volume}
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
        volume={clip.volume}
        muted={clip.muted}
        crossOrigin="anonymous"
        onError={onMediaError}
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
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
          objectFit: layer?.type === "image" ? layer.properties.fit : "contain",
        }}
      />
    );
  else if (layer?.type === "text" || layer?.type === "caption")
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
      {content}
    </div>
  );
}
