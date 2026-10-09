import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HELPER, SOMETHING_ELSE, STORYTELLING, VibePicker } from "@/components/VibePicker";

const render = (tags: string[]) =>
  renderToStaticMarkup(createElement(VibePicker, { tags, onChange: () => {}, onSomethingElse: () => {} }));
const buttons = (html: string) => html.match(/<button[^>]*>.*?<\/button>/g) ?? [];
const label = (b: string) => b.replace(/<[^>]+>/g, "");
const find = (html: string, text: string) => buttons(html).find((b) => label(b) === text)!;

describe("VibePicker", () => {
  it("shows one cloud in order, ending with Storytelling and Something else; sub-chips start hidden", () => {
    const html = render([]);
    expect(buttons(html).map(label)).toEqual([
      "Funny", "Emotional", "Motivational", "Energetic", "Romantic", "Deep", "Nostalgic", "Educational", "Challenge",
      STORYTELLING, SOMETHING_ELSE,
    ]);
    expect(find(html, STORYTELLING)).toContain('aria-expanded="false"');
    expect(find(html, STORYTELLING)).not.toContain("aria-pressed");
    expect(find(html, SOMETHING_ELSE)).not.toContain("aria-pressed");
    expect(html).not.toContain("Day in the Life");
  });

  it("shows one helper line and none of the old lines", () => {
    const html = render([]);
    expect(HELPER).toBe("Optional. Tap up to 3, or skip it and we'll read your video.");
    expect(html).toContain("Optional. Tap up to 3, or skip it and we&#x27;ll read your video.");
    expect(html).toContain("How should it feel?");
    expect(html).not.toContain("Tap up to 3. Optional.");
    expect(html).not.toContain("Skip this and we&#x27;ll figure it out from your video.");
  });

  it("with a sub-chip on, Storytelling is selected and the sub-chips show under the row", () => {
    const html = render(["Sad Storytelling"]);
    const parent = find(html, STORYTELLING);
    expect(parent).toContain('aria-expanded="true"');
    expect(parent).toContain("bg-ink text-white");
    expect(parent).toContain("<svg");
    expect(find(html, "Positive")).toContain('aria-pressed="false"');
    expect(find(html, "Emotional")).toContain('aria-pressed="false"');
    expect(find(html, "Sad")).toContain('aria-pressed="true"');
    expect(find(html, "Sad")).toContain("h-9");
  });

  it("with 3 picked, other chips (sub-chips included) dim but Something else stays available", () => {
    const html = render(["Funny", "Deep", "Positive Storytelling"]);
    const dimmed = buttons(html).filter((b) => b.includes('aria-disabled="true"')).map(label);
    expect(dimmed).toEqual(["Emotional", "Motivational", "Energetic", "Romantic", "Nostalgic", "Educational", "Challenge", "Emotional", "Sad"]);
    expect(find(html, SOMETHING_ELSE)).not.toContain("aria-disabled");
    expect(find(html, STORYTELLING)).not.toContain("aria-disabled");
  });

  it("with 3 non-story tags, the closed Storytelling chip dims too", () => {
    expect(find(render(["Funny", "Deep", "Educational"]), STORYTELLING)).toContain('aria-disabled="true"');
  });
});
