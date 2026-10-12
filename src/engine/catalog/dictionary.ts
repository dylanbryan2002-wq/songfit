// The new engine's song dictionary (Dylan, 2026-10-11): 5,032 songs pre-mapped into the shared dictionary the video is also
// read into. Labels only, never lyrics. Built offline by scripts/groundtruth/build-dictionary.ts; server-only.
import "server-only";
import { z } from "zod";
import RAW from "@/src/engine/catalog/dictionary.data.json";

export const FEELINGS = ["Motivational", "Inspirational", "Reflective", "Heartfelt", "Sad", "Nostalgic", "Funny", "Upbeat", "Hype", "Calm/Focused", "Dramatic"] as const;
const Confidence = z.enum(["high", "medium", "low", "flagged"]);

export const SongEntrySchema = z.object({
  id: z.string(),                                   // Deezer track id
  title: z.string(),
  artist: z.string(),
  year: z.number().nullable(),
  feelings: z.record(z.enum(FEELINGS), Confidence), // feeling -> how sure the label is
  energy: z.number().min(0).max(1).nullable(),
  valence: z.number().min(0).max(1).nullable(),
  tempo: z.number().nullable(),
  vocals: z.enum(["vocals", "instrumental", "unsure", "unknown"]),
  explicit: z.boolean(),
  theme: z.string().nullable(),                     // main lyric theme ("none" = instrumental), from words read in memory
  flags: z.array(z.string()),                       // lyric clash flags
  sections: z.object({
    instrumental: z.boolean(),
    first_vocal: z.number().nullable(),
    chorus: z.array(z.number()),
    gaps: z.array(z.tuple([z.number(), z.number()])),
  }).nullable(),                                    // null = no timing data
  creator_types: z.array(z.string()),               // content types creators used this song for
  rank_pct: z.number().min(0).max(1).nullable(),    // Deezer popularity position, 0 = most popular
});
export type SongEntry = z.infer<typeof SongEntrySchema>;

export const DICTIONARY: SongEntry[] = z.array(SongEntrySchema).parse(RAW);
