import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const viewer = vi.fn();
const listAccountRuns = vi.fn();
const logEvent = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  useRouter: () => ({ replace: () => {}, push: () => {} }),
}));
vi.mock("@/src/auth/session", () => ({ getViewer: () => viewer() }));
vi.mock("@/src/feedback/events", () => ({ logEvent: (e: unknown) => logEvent(e) }));
vi.mock("@/src/db/queries/account", async () => {
  const real = await vi.importActual<Record<string, unknown>>("@/src/db/queries/account");
  return { ...real, listAccountRuns: (...a: unknown[]) => listAccountRuns(...a) };
});
vi.mock("server-only", () => ({}));

const { default: AccountPage } = await import("@/app/account/page");

const ID = "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b";
const render = async (search: Record<string, string> = {}) =>
  renderToStaticMarkup(await AccountPage({ searchParams: Promise.resolve(search) }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

beforeEach(() => {
  viewer.mockReset();
  listAccountRuns.mockReset();
  logEvent.mockReset();
  viewer.mockResolvedValue({ id: "c1", anonymous: false, email: "maya@example.com" });
});

describe("/account", () => {
  it("sends anonymous visitors and signed-out visitors home", async () => {
    viewer.mockResolvedValue({ id: "a1", anonymous: true, email: null });
    await expect(render()).rejects.toThrow("redirect:/");
    viewer.mockResolvedValue(null);
    await expect(render()).rejects.toThrow("redirect:/");
    expect(listAccountRuns).not.toHaveBeenCalled();
  });

  it("lists rows linking to their results, with Show more, the stored block, and logs account_viewed", async () => {
    const now = new Date().toISOString();
    listAccountRuns.mockResolvedValue({
      runs: [
        { id: ID, created_at: now, status: "ready", chosen: { title: "Waiting Room", artist: "Fugazi", artwork_url: "https://e-cdns-images.dzcdn.net/a.jpg" } },
        { id: "r2", created_at: now, status: "analyzing", chosen: null },
      ],
      next: `${now}_${ID}`,
    });
    const html = await render();
    const t = text(html);
    expect(listAccountRuns).toHaveBeenCalledWith("c1", null);
    expect(html).toContain(`href="/results/${ID}"`);
    expect(html).toContain('src="https://e-cdns-images.dzcdn.net/a.jpg"');
    expect(t).toContain("Today");
    expect(t).toContain("Chose: Waiting Room · Fugazi");
    expect(t).toContain("Finding songs…");
    expect(html).toContain(`href="/account?before=${encodeURIComponent(`${now}_${ID}`)}"`);
    expect(t).toContain("Show more");
    expect(t).toContain("Your account details, uploaded videos, the analysis of them, song results and activity.");
    expect(html).toContain('href="/privacy"');
    expect(t).not.toContain("To delete your account, email");
    expect(t).toContain("Delete my account");
    // Each row: a link to its results and, outside it, a Delete button.
    const rows = html.match(/<li[\s\S]*?<\/li>/g) ?? [];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const link = row.match(/<a [\s\S]*?<\/a>/)![0];
      expect(link).not.toContain("<button");
      expect(row.replace(link, "")).toMatch(/<button[^>]*>Delete<\/button>/);
    }
    expect(t).toContain("Signed in as maya@example.com");
    expect(t).toContain("Sign out");
    expect(logEvent).toHaveBeenCalledWith({ name: "account_viewed", creatorId: "c1" });
  });

  it("passes a valid cursor through and ignores a malformed one", async () => {
    listAccountRuns.mockResolvedValue({ runs: [], next: null });
    await render({ before: `2026-10-09T12:00:00Z_${ID}` });
    expect(listAccountRuns).toHaveBeenLastCalledWith("c1", { createdAt: "2026-10-09T12:00:00Z", id: ID });
    await render({ before: "nonsense" });
    expect(listAccountRuns).toHaveBeenLastCalledWith("c1", null);
  });

  it("empty state: No videos yet. and a link home", async () => {
    listAccountRuns.mockResolvedValue({ runs: [], next: null });
    const html = await render();
    expect(text(html)).toContain("No videos yet.");
    expect(html).toContain('href="/"');
    expect(text(html)).not.toContain("Show more");
  });
});
