export { DIMENSIONS } from "@/src/shared/types";
export const MODEL_DIMENSIONS = ["semantic", "emotional", "aesthetic", "pacing", "cultural", "originality"] as const;
export type ModelDimension = (typeof MODEL_DIMENSIONS)[number];
