"use client";
import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import { useStore } from "zustand";
import { createTimelineStore } from "./interaction-store.cjs";
import type { TimelineState } from "./interaction-types";
const Context = createContext<ReturnType<typeof createTimelineStore> | null>(null);
export function TimelineProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createTimelineStore);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useOptionalTimelineStore() {
  return useContext(Context);
}
export function useTimelineStoreApi() {
  const store = useContext(Context);
  if (!store) throw new Error("Timeline provider is missing");
  return store;
}
export function useTimeline<T>(selector: (state: TimelineState) => T) {
  return useStore(useTimelineStoreApi(), selector);
}
