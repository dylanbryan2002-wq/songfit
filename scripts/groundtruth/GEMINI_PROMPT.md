You are helping evaluate a music recommendation engine for short-form video. The attached file is a SCREEN RECORDING of a public Instagram Reel or TikTok. Ignore the platform UI overlay (captions bar, like counts, username, buttons). Watch the whole clip with sound.

Give me two parts.

PART 1, in plain words (under 150 words): what happens in the video, the single most important moment and its time in seconds, and what the music is doing at that moment.

PART 2, one fenced ```json block with exactly these keys and nothing else outside the block:

{
  "summary": "one or two sentences on what the video is",
  "content_category": "one of: fashion, beauty, fitness, travel, food, lifestyle, comedy, music, dance, education, business, gaming, pets, family, other",
  "setting": "where it takes place",
  "story": "the arc or joke in one sentence, or null",
  "energy": "low | medium | medium-high | high",
  "pacing": "slow | medium | fast",
  "mood": ["two to four mood words"],
  "aesthetic": ["two to four visual style words"],
  "dialogue_present": true or false,
  "key_moments": [{"time": seconds as a number, "type": "cut | reveal | punchline | action | text | transition", "note": "what happens"}],
  "song": {"title": "your best guess or null", "artist": "your best guess or null", "confidence": "high | medium | low"},
  "music": {
    "section_start_seconds_in_song": number or null (how far into the song the clip's audio starts, if you can tell),
    "hits": [{"video_time": seconds as a number, "what_music_does": "beat drop, vocal entry, chorus, silence, build, etc."}],
    "role": "contrast | amplify | punchline | trend | narration | other",
    "role_note": "one sentence on how the song is being used",
    "why_it_works": "one sentence on why this song fits this video"
  },
  "brief": {
    "text": "two or three sentences describing the ideal song for this video, written without naming the actual song",
    "moods": ["mood words a song should have"],
    "energy": a number from 0 to 1,
    "tempo": "slow | mid | fast | or a bpm range",
    "vocals": "none | sparse | prominent | male | female | rap | any",
    "genres": ["one to three genres"],
    "familiarity": "obscure | known | famous | trending"
  }
}

Use real seconds measured from the start of the video. If you are not sure of a value, give your best guess rather than leaving it out; use null only where allowed above.
