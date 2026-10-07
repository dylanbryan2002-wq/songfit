import { z } from "zod";

const uuid = z.string().uuid();

export function isUuid(id: string): boolean {
  return uuid.safeParse(id).success;
}
