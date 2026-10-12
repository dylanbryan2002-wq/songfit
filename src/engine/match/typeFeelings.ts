// Content type -> song feelings it allows (Dylan approved, 2026-10-11; design notes in ~/Songfit-groundtruth/design/song-labels.md).
// Storytelling takes its story feeling. Used as the content-type fit signal, never as a hard cut.
export const TYPE_FEELINGS: Record<string, string[]> = {
  "Educational": ["Calm/Focused", "Upbeat", "Reflective"],
  "Vlog": ["Upbeat", "Calm/Focused", "Nostalgic"],
  "Storytelling": ["Heartfelt", "Reflective", "Dramatic"],
  "Storytelling: emotional": ["Heartfelt", "Reflective", "Dramatic", "Sad"],
  "Storytelling: sad": ["Sad", "Heartfelt", "Reflective", "Nostalgic"],
  "Storytelling: inspirational": ["Inspirational", "Heartfelt", "Dramatic", "Reflective"],
  "Storytelling: motivational": ["Motivational", "Inspirational", "Dramatic", "Hype"],
  "Storytelling: funny": ["Funny", "Upbeat"],
  "Storytelling: interesting": ["Upbeat", "Calm/Focused", "Dramatic"],
  "Storytelling: deep": ["Reflective", "Heartfelt", "Sad"],
  "Building in public": ["Inspirational", "Motivational", "Upbeat", "Calm/Focused", "Dramatic"],
  "Funny/Upbeat": ["Funny", "Upbeat", "Hype"],
  "Motivational": ["Motivational", "Hype", "Dramatic", "Inspirational"],
  "Product/Review": ["Upbeat", "Calm/Focused"],
  "Aesthetic/Montage": [],
  "Challenge": ["Hype", "Dramatic", "Motivational"],
  "Deep": ["Reflective", "Sad", "Heartfelt"],
  "Advice": ["Calm/Focused", "Reflective", "Upbeat", "Inspirational"],
  "Commentary/Opinion": ["Calm/Focused", "Upbeat", "Dramatic", "Funny"],
  "Reaction": ["Funny", "Upbeat", "Dramatic"],
  "Podcast/Interview": ["Reflective", "Calm/Focused", "Dramatic", "Inspirational"],
};

/** "Storytelling" + feeling -> "Storytelling: feeling"; v1 labels map to the new ones. */
export function typeKey(type: string, storyFeeling: string | null | undefined): string {
  if (type === "Sad storytelling") return "Storytelling: sad";
  if (type === "Inspirational storytelling") return "Storytelling: inspirational";
  return type === "Storytelling" && storyFeeling ? `Storytelling: ${storyFeeling}` : type;
}
