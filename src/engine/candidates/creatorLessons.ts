// Lessons from real Reels in our niche: what the creator's song did for the viewer, and what should carry over to other
// videos (docs/review/27, v2). Drafted from tune-split clips only; each is checked by Dylan against the original Reel
// (checked: true once confirmed). Song names come from the audio fingerprint, not from Gemini.
import type { MusicJob } from "@/src/shared/types";

export const LESSONS_VERSION = "lessons-2026-10-09-draft";

export type Lesson = { job: MusicJob; video: string; song: string; lesson: string; transfer: string; incidental: string; checked: boolean };

export const LESSONS: Lesson[] = [
  { job: "familiar_anthem", video: "A creator tells the story of the no-phone Y2K throwback party she threw, cut with crowd and dance-floor clips.", song: "Stereo Love — Edward Maya, Vika Jigulina",
    lesson: "An era-themed story gets a famous dance hit from that era: the song is the time machine, played loud under the talking, not a quiet bed.",
    transfer: "Match the era and the party energy with a song everyone recognises.", incidental: "This exact song; any era-defining club hit works.", checked: false },
  { job: "drive_energy", video: "A creator explains dropping out of college at 21 for his job, packing up and flying across the country.", song: "Miss Alissa — Eagles of Death Metal",
    lesson: "A big life leap told to camera gets driving rock, not reflective piano: the music makes the decision feel bold and exciting.",
    transfer: "Momentum and swagger under a career-leap story, even with speech.", incidental: "The genre; any high-energy track that pushes forward works.", checked: false },
  { job: "drive_energy", video: "An interview with a startup CEO on how to build a company from scratch, with fast whiteboard and b-roll cuts.", song: "Vivaldi — Summer, Presto (I Solisti di Zagreb)",
    lesson: "A fast business explainer gets frantic, busy classical music: it adds urgency and drama under the talking instead of sitting quietly.",
    transfer: "Busy, urgent music can sit under speech when the edit is fast.", incidental: "Classical specifically; any propulsive, urgent piece works.", checked: false },
  { job: "comic_cue", video: "On-screen text jokes about seeing the same gym-goers at two completely different times of day; the creator looks suspicious.", song: "Law & Order Theme — Mike Post",
    lesson: "The joke is suspicion, so the song is a famous crime-show theme: the music IS the punchline.",
    transfer: "A recognisable genre reference that says the joke.", incidental: "This theme; any instantly recognisable cue for the joke's idea works.", checked: false },
  { job: "comic_cue", video: "A creator investigates, mock-seriously, why his freezer keeps making a spiky ice cube, with dramatic zooms and Google searches.", song: "My Life — Billy Joel",
    lesson: "A mock-serious mystery gets an upbeat, familiar classic: the cheerful song makes the overreaction funny.",
    transfer: "Light, familiar, upbeat music against a fake-dramatic story.", incidental: "The song; the contrast is what matters.", checked: false },
  { job: "comic_cue", video: "Two 19-year-old founders fake-flex their brand's success, then admit they made it up and had nothing.", song: "Bad — Michael Jackson",
    lesson: "A fake flex gets an iconic swagger anthem: the famous song sells the flex, so the confession lands as a joke.",
    transfer: "A famous, confident song for a flex that turns out to be ironic.", incidental: "Michael Jackson; any iconic swagger song works.", checked: false },
  { job: "drive_energy", video: "A graduate tells how she quit a six-figure job in New York to move to London and build a startup.", song: "Brazil — Declan McKenna",
    lesson: "A risky life change told with a smile gets bright, bouncy indie: it feels like an adventure, not a sad goodbye.",
    transfer: "Cheerful, upbeat indie under a brave-change story.", incidental: "The artist; any upbeat, optimistic guitar track works.", checked: false },
  { job: "drive_energy", video: "A countdown, then a developer opens a laptop to reveal the habit-tracking app he built. No talking.", song: "Way Too Self Aware — Ian Asher",
    lesson: "A reveal edit gets a track whose beat drops exactly as the laptop opens.",
    transfer: "The drop lands on the reveal.", incidental: "The song; any track with a clear drop at the right moment.", checked: false },
  { job: "emotional_lift", video: "A lifestyle montage with reminders to call your parents, take trips and protect your peace.", song: "Iris — The Goo Goo Dolls",
    lesson: "A life-affirming montage gets a soaring, famous 90s ballad, not solemn piano: everyone already feels something when it starts.",
    transfer: "Emotional lift through a recognisable song with a big chorus.", incidental: "This song; any well-known soaring anthem works.", checked: false },
  { job: "emotional_lift", video: "A narrated nostalgic montage of a summer in New York: city moments, basketball, a storm, a first kiss.", song: "Lazy Eye — Silversun Pickups",
    lesson: "A nostalgic summer montage gets a swelling 2000s indie-rock song: guitars build the bittersweet rush, not ambient pads.",
    transfer: "Bittersweet euphoria through a building band track.", incidental: "The exact band; any swelling indie-rock song works.", checked: false },
  { job: "quiet_bed", video: "A woman reads an emotional handwritten letter to her younger self, sitting in a park.", song: "Evergreen — Richy Mitch & The Coal Miners",
    lesson: "A letter read aloud really is a quiet bed, but a warm, intimate acoustic guitar song, not cinematic piano.",
    transfer: "Intimate, warm, human texture that stays under the voice.", incidental: "Acoustic guitar specifically; warmth and closeness are what matter.", checked: false },
  { job: "quiet_bed", video: "A calm, slow monologue to camera giving advice about never arguing with an audience that has already picked a side.", song: "Adagio in C Minor — London Music Works",
    lesson: "A slow, measured advice monologue is the case where a quiet classical bed is right: the words carry it, the music only adds weight.",
    transfer: "Only when the delivery itself is slow and serious does calm strings or piano win.", incidental: "The piece; restraint and gravity are what matter.", checked: false },
];

/** The block appended to the candidates system prompt when lessons are on. Identical for every video. */
export function lessonsBlock(lessons: Lesson[] = LESSONS): string {
  return [
    "HOW CREATORS IN THIS NICHE ACTUALLY CHOOSE (real Reels and the song the creator used). Learn the pattern, not the list:",
    "reuse one of these songs only if it truly fits this video. The point is what the music DOES for the viewer.",
    ...lessons.map((l, i) => `${i + 1}. ${l.video} → ${l.song}. ${l.lesson} Carries over: ${l.transfer} Doesn't matter: ${l.incidental}`),
  ].join("\n");
}
