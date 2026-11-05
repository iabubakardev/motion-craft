"use client";
import { useCallback, useRef } from "react";
import type { PlayerRef } from "@remotion/player";
import { useTimelineStoreApi } from "@/features/timeline/timeline-store";

export function useTimelinePlayer(duration: number) {
  const player = useRef<PlayerRef | null>(null);
  const store = useTimelineStoreApi();
  const connect = useCallback(
    (instance: PlayerRef | null) => {
      if (!instance) return;
      player.current = instance;
      let publishing = false;
      const seek = (frame: number) => {
        const target = Math.max(0, Math.min(duration - 1, frame));
        if (instance.getCurrentFrame() !== target) instance.seekTo(target);
      };
      const publish = ({ detail }: { detail: { frame: number } }) => {
        // A paused authoring cursor may legitimately sit beyond the current project end.
        if (!instance.isPlaying() && store.getState().playheadFrame >= duration) return;
        publishing = true;
        store.getState().setPlayhead(detail.frame);
        publishing = false;
      };
      const play = () => store.getState().setPlaying(true);
      const pause = () => store.getState().setPlaying(false);
      instance.addEventListener("frameupdate", publish);
      instance.addEventListener("play", play);
      instance.addEventListener("pause", pause);
      instance.addEventListener("ended", pause);
      seek(store.getState().playheadFrame);
      store.getState().setPlaying(instance.isPlaying());
      const unsubscribe = store.subscribe((state, previous) => {
        if (!publishing && state.playheadFrame !== previous.playheadFrame)
          seek(state.playheadFrame);
      });
      return () => {
        unsubscribe();
        instance.removeEventListener("frameupdate", publish);
        instance.removeEventListener("play", play);
        instance.removeEventListener("pause", pause);
        instance.removeEventListener("ended", pause);
        if (player.current === instance) player.current = null;
        store.getState().setPlaying(false);
      };
    },
    [duration, store],
  );
  const toggle = useCallback(() => {
    const instance = player.current;
    if (!instance) return;
    if (instance.isPlaying()) instance.pause();
    else {
      if (store.getState().playheadFrame >= duration - 1) {
        store.getState().setPlayhead(0);
        instance.seekTo(0);
      }
      instance.play();
    }
  }, [duration, store]);
  return { player, connect, toggle };
}
