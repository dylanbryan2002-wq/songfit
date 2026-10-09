import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, replace: () => {} }) }));

import {
  DELETE_FAILED,
  DeleteVideoView,
  WAIT_FOR_VIDEO,
  deleteVideoError,
} from "@/components/account/DeleteVideoButton";
import {
  DeleteAccountView,
  WAIT_FOR_RUNS,
  deleteAccountError,
} from "@/components/account/DeleteAccount";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
const buttons = (html: string) => (html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? []).map((b) => ({ html: b, text: text(b) }));
const noop = () => {};
const video = (p: Partial<Parameters<typeof DeleteVideoView>[0]>) =>
  renderToStaticMarkup(
    createElement(DeleteVideoView, { label: "Delete", phase: "idle", error: null, onAsk: noop, onConfirm: noop, onKeep: noop, ...p }),
  );
const account = (p: Partial<Parameters<typeof DeleteAccountView>[0]>) =>
  renderToStaticMarkup(
    createElement(DeleteAccountView, {
      open: false, value: "", busy: false, error: null, onOpen: noop, onChange: noop, onSubmit: noop, onCancel: noop, ...p,
    }),
  );

describe("delete a video: inline confirm", () => {
  it("idle shows only the label", () => {
    expect(buttons(video({})).map((b) => b.text)).toEqual(["Delete"]);
    expect(buttons(video({ label: "Delete this video" })).map((b) => b.text)).toEqual(["Delete this video"]);
  });

  it("confirm: Delete for good? · Yes, delete · Keep", () => {
    const html = video({ phase: "confirm" });
    expect(text(html)).toBe("Delete for good? · Yes, delete · Keep");
    expect(buttons(html).map((b) => b.text)).toEqual(["Yes, delete", "Keep"]);
  });

  it("busy disables both buttons; an error shows under the confirm", () => {
    expect(buttons(video({ phase: "busy" })).every((b) => b.html.includes(' disabled=""'))).toBe(true);
    expect(text(video({ phase: "confirm", error: DELETE_FAILED }))).toContain("Deletion didn't finish. Try again.");
  });

  it("maps statuses to copy", () => {
    expect(deleteVideoError(409)).toBe("Wait for this video to finish.");
    expect(WAIT_FOR_VIDEO).toBe("Wait for this video to finish.");
    expect(deleteVideoError(500)).toBe("Deletion didn't finish. Try again.");
    expect(deleteVideoError(403)).toBe(DELETE_FAILED);
  });
});

describe("delete my account: typed DELETE", () => {
  it("closed shows the Delete my account button", () => {
    expect(buttons(account({})).map((b) => b.text)).toEqual(["Delete my account"]);
  });

  it("open: the warning, a DELETE field set up for phones, Delete everything disabled until it matches", () => {
    const html = account({ open: true, value: "delet" });
    expect(text(html)).toContain("This removes your videos, songs and account. Type DELETE to confirm.");
    expect(html).toContain('autoCapitalize="characters"');
    expect(html).toContain('autoCorrect="off"');
    expect(html).toContain('spellCheck="false"');
    expect(html).not.toContain("onPaste");
    const del = buttons(html).find((b) => b.text === "Delete everything")!;
    expect(del.html).toContain(' disabled=""');
    expect(del.html).toContain("border-red");
    const ready = buttons(account({ open: true, value: "DELETE" })).find((b) => b.text === "Delete everything")!;
    expect(ready.html).not.toContain(' disabled=""');
  });

  it("shows the failure line and maps statuses to copy", () => {
    expect(text(account({ open: true, value: "DELETE", error: DELETE_FAILED }))).toContain("Deletion didn't finish. Try again.");
    expect(deleteAccountError(409)).toBe("Wait for your current video to finish.");
    expect(WAIT_FOR_RUNS).toBe("Wait for your current video to finish.");
    expect(deleteAccountError(500)).toBe(DELETE_FAILED);
  });
});
