"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { startAI, statusAI, cancelAI } from "@/platform/ai";
import type { AIJob, AIRequest } from "@/platform/ai";
const terminal = (job: AIJob) => ["completed", "failed", "cancelled"].includes(job.state);
export function useAIJob() {
  const [job, setJob] = useState<AIJob | null>(null),
    [error, setError] = useState("");
  const active = useRef<string | null>(null),
    mounted = useRef(true),
    starting = useRef(false);
  const [startingUI, setStarting] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (active.current) void cancelAI(active.current).catch(() => {});
    };
  }, []);
  const jobId = job?.id,
    polling = !!job && !terminal(job);
  useEffect(() => {
    if (!jobId || !polling) return;
    const id = jobId;
    let pending = false,
      obsolete = false;
    const timer = setInterval(async () => {
      if (pending) return;
      pending = true;
      try {
        const current = await statusAI();
        if (!obsolete && current?.id === id) {
          setJob(current);
          if (terminal(current)) active.current = null;
        }
      } catch (failure) {
        if (!obsolete)
          setError(failure instanceof Error ? failure.message : "Could not read AI status");
      } finally {
        pending = false;
      }
    }, 300);
    return () => {
      obsolete = true;
      clearInterval(timer);
    };
  }, [jobId, polling]);
  const start = useCallback(async (request: AIRequest) => {
    if (starting.current || active.current) return;
    starting.current = true;
    setStarting(true);
    setError("");
    try {
      const next = await startAI(request);
      if (!mounted.current) {
        await cancelAI(next.id);
        return;
      }
      active.current = next.id;
      setJob(next);
    } catch (failure) {
      if (mounted.current)
        setError(failure instanceof Error ? failure.message : "Could not start AI task");
    } finally {
      starting.current = false;
      if (mounted.current) setStarting(false);
    }
  }, []);
  return {
    job,
    error,
    starting: startingUI,
    running: startingUI || (!!job && !terminal(job)),
    start,
    cancel: () =>
      active.current
        ? cancelAI(active.current).then((next) => {
            if (mounted.current) setJob(next);
          })
        : Promise.resolve(),
  };
}
