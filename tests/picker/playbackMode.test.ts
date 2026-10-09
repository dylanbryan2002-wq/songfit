import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ALONE_NOTE, aloneNext, playbackModeFor, type AloneSides } from "@/src/picker/playback";
import { SongPicker } from "@/components/picker/SongPicker";
import type { PickerData } from "@/src/shared/types";

const idle: AloneSides = { video: "looping-muted", sample: "stopped" };

describe("playbackModeFor", () => {
  it("is sync for admins and alone for everyone else", () => {
    expect(playbackModeFor(true)).toBe("sync");
    expect(playbackModeFor(false)).toBe("alone");
  });
});

describe("aloneNext", () => {
  it("playing a sample freezes the video", () => {
    expect(aloneNext(idle, "playSample")).toEqual({ video: "paused", sample: "playing" });
    expect(aloneNext({ video: "playing-unmuted", sample: "stopped" }, "playSample")).toEqual({
      video: "paused",
      sample: "playing",
    });
  });
  it("tapping the video stops the sample and plays the video with its sound", () => {
    expect(aloneNext({ video: "paused", sample: "playing" }, "tapVideo")).toEqual({
      video: "playing-unmuted",
      sample: "stopped",
    });
    expect(aloneNext(idle, "tapVideo")).toEqual({ video: "playing-unmuted", sample: "stopped" });
  });
  it("tapping the video again pauses it", () => {
    expect(aloneNext({ video: "playing-unmuted", sample: "stopped" }, "tapVideo")).toEqual({
      video: "paused",
      sample: "stopped",
    });
  });
  it("stopping the sample resumes the muted loop", () => {
    expect(aloneNext({ video: "paused", sample: "playing" }, "stopSample")).toEqual({
      video: "looping-muted",
      sample: "stopped",
    });
  });
  it("never has both sides sounding", () => {
    let states: AloneSides[] = [idle];
    for (let i = 0; i < 3; i++)
      states = states.flatMap((s) => [s, ...(["playSample", "tapVideo", "stopSample"] as const).map((e) => aloneNext(s, e))]);
    expect(states.some((s) => s.video === "playing-unmuted" && s.sample === "playing")).toBe(false);
  });
});

const data = {
  submission_id: "00000000-0000-0000-0000-000000000001",
  video_duration_seconds: 12,
  rows: [
    {
      rank: 1, direction_label: "Best fit", title: "Song", artist: "Artist", start_seconds: 43, end_seconds: 58,
      explanation: "Because.", artwork_url: null, spotify_url: "s", deezer_url: null, deezer_id: "1",
      preview_url: "https://p.mp3", selected: false, rejected: false,
    },
  ],
} as unknown as PickerData;
const render = (playbackMode: "sync" | "alone") =>
  renderToStaticMarkup(createElement(SongPicker, { data, videoUrl: "https://v.mp4", playbackMode }));

describe("SongPicker playback mode", () => {
  it("shows the samples-alone line only in alone mode", () => {
    expect(ALONE_NOTE).toBe("Samples play on their own. Add the song in TikTok or Instagram to hear it over your video.");
    expect(render("alone")).toContain(ALONE_NOTE);
    expect(render("sync")).not.toContain(ALONE_NOTE);
  });
  it("renders both sliders in both modes", () => {
    for (const mode of ["sync", "alone"] as const) {
      const html = render(mode);
      expect(html).toContain("Your voice");
      expect(html).toContain("Music");
    }
  });
  it("shows the video play control only in alone mode", () => {
    expect(render("alone")).toContain('aria-label="Play your video with sound"');
    expect(render("sync")).not.toContain("your video with sound");
  });
});
