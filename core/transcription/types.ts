import type { z } from "zod";
import type {
  requestSchema,
  transcriptSchema,
  segmentSchema,
  wordSchema,
  resultSchema,
  errorSchema,
  eventSchema,
  configSchema,
} from "./schema.cjs";
import type { jobSchema } from "@/core/ai/schema.cjs";
export type TranscriptionRequest = z.infer<typeof requestSchema>;
export type TranscriptionSegment = z.infer<typeof segmentSchema>;
export type TranscriptionWord = z.infer<typeof wordSchema>;
export type TranscriptionResult = z.infer<typeof resultSchema>;
export type TranscriptionError = z.infer<typeof errorSchema>;
export type WorkerEvent = z.infer<typeof eventSchema>;
export type Transcript = z.infer<typeof transcriptSchema>;
export type TranscriptionConfiguration = z.infer<typeof configSchema>;
export type TranscriptionJob = z.infer<typeof jobSchema>;
