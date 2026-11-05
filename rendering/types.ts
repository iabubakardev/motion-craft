import type { z } from "zod";
import type { renderInputSchema, buildComposition } from "./input.cjs";
export type RenderInput = z.infer<typeof renderInputSchema>;
export type CompositionModel = ReturnType<typeof buildComposition>;
export type CompositionClip = CompositionModel["clips"][number];
