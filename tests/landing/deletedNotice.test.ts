import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, push: () => {} }) }));
vi.mock("@/src/auth/session", () => ({ getViewer: async () => null }));
vi.mock("@/src/billing/rateLimit", () => ({ uploadsLeft: async () => 3 }));

const { default: HomePage } = await import("@/app/page");

const render = async (search: Record<string, string>) =>
  renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve(search) }));

describe("landing after account deletion", () => {
  it("shows one line at /?deleted=1, nothing otherwise", async () => {
    expect(await render({ deleted: "1" })).toContain("Your account is gone.");
    expect(await render({})).not.toContain("Your account is gone.");
  });
});
