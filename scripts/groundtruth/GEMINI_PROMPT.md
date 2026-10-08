I am uploading a screen recording of an Instagram Reel or TikTok that went viral. Watch it with sound. Because it is a screen recording, ignore the platform's UI overlay (caption bar, username, like/comment/share counts, music label, progress bar, phone status bar) and describe only the creator's video itself.

Do two things.

First, in a few short paragraphs of plain text: what happens in the video, what the music is doing at each moment that matters (where the hook, drop, vocal entry or a lyric lands relative to the cuts and the key moment), what job the song does for the video, and in one line why this song works for this clip.

Then output ONE fenced ```json block with exactly these keys and no others:

- summary: string, 1–2 sentences on what happens.
- content_category: string, exactly one of: fashion, beauty, fitness, travel, food, lifestyle, comedy, music, dance, education, business, gaming, pets, family, other.
- setting: string or null.
- story: string or null, the arc or the joke if there is one.
- energy: one of "low", "medium", "medium-high", "high".
- pacing: one of "slow", "medium", "fast".
- mood: array of 2–5 words.
- aesthetic: array of 2–5 words.
- dialogue_present: boolean, true only if a person speaks to the viewer (talking to camera, voiceover, conversation); singing or lip-syncing is not dialogue.
- key_moments: array of { "time": seconds from the start of the video, "type": one of scene_change, main_visual_reveal, climax, transition, text_overlay, beat_cut, "note": short string }. At most 6.
- song: { "title": string, "artist": string, "confidence": "high" | "medium" | "low" }, your best identification of the song you hear.
- music: {
  "section_start_seconds_in_song": number or null, where in the full song the audio you hear starts, if you know the song well enough;
  "hits": array of { "video_time": seconds, "what_music_does": string }, one per visual moment that matters (hook, drop, vocal entry, build, break, lyric that lands);
  "role": one of "contrast", "amplify", "punchline", "trend", "narration", "other";
  "role_note": one sentence on how that role plays out here;
  "why_it_works": one line a music supervisor would say }
- brief: the brief a music supervisor would need to find a song like this one, written from the visuals and the feel without naming the song: {
  "text": 3–6 plain sentences;
  "moods": array of words;
  "energy": number from 0 to 1;
  "tempo": one of "slow", "medium", "medium-high", "high";
  "vocals": one of "vocals", "instrumental", "either";
  "genres": array of strings;
  "familiarity": one of "recognizable", "recognizable_not_overused", "unexpected" }

The JSON must be valid: no comments, no trailing commas, every key present, null only where allowed. Shape:

```json
{
  "summary": "", "content_category": "", "setting": null, "story": null,
  "energy": "medium", "pacing": "medium", "mood": [], "aesthetic": [], "dialogue_present": false,
  "key_moments": [{ "time": 0, "type": "scene_change", "note": "" }],
  "song": { "title": "", "artist": "", "confidence": "medium" },
  "music": { "section_start_seconds_in_song": null, "hits": [{ "video_time": 0, "what_music_does": "" }], "role": "amplify", "role_note": "", "why_it_works": "" },
  "brief": { "text": "", "moods": [], "energy": 0.5, "tempo": "medium", "vocals": "either", "genres": [], "familiarity": "recognizable" }
}
```
