import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SOMETHING_ELSE, VibePicker } from "@/components/VibePicker";

const render = (tags: string[]) =>
  renderToStaticMarkup(createElement(VibePicker, { tags, onChange: () => {}, onSomethingElse: () => {} }));

describe("VibePicker", () => {
  it("ends with the Something else chip, which is not a toggle, and drops removed chips", () => {
    const html = render([]);
    expect(html).not.toContain("Day in the Life");
    expect(html).not.toContain("Travel");
    const buttons = html.match(/<button[^>]*>.*?<\/button>/g) ?? [];
    const last = buttons[buttons.length - 1];
    expect(last).toContain(SOMETHING_ELSE);
    expect(last).not.toContain("aria-pressed");
    expect(html).toContain("Skip this and we&#x27;ll figure it out from your video.");
  });

  it("with 3 picked, other chips dim but Something else stays available", () => {
    const html = render(["Funny", "Deep", "Educational"]);
    const buttons = html.match(/<button[^>]*>.*?<\/button>/g) ?? [];
    expect(buttons.filter((b) => b.includes('aria-disabled="true"'))).toHaveLength(buttons.length - 4);
    expect(buttons[buttons.length - 1]).not.toContain("aria-disabled");
  });
});
