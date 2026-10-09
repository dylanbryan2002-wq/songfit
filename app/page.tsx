import { getViewer, type Viewer } from "@/src/auth/session";
import { uploadsLeft } from "@/src/billing/rateLimit";
import { isUuid } from "@/src/shared/ids";
import { logger } from "@/src/shared/logger";
import { Logo } from "@/components/Logo";
import { CreatorUpload } from "@/components/CreatorUpload";
import { AREA } from "@/components/landing/Hero";
import { Landing } from "@/components/landing/Landing";

export const dynamic = "force-dynamic";

type Search = { resume?: string | string[]; auth?: string | string[]; deleted?: string | string[] };

/** The viewer's allowance under the 24 h cap; null (hidden) when there is no session or the count fails. */
async function allowance(viewer: Viewer | null): Promise<number | null> {
  if (!viewer) return null;
  try {
    return await uploadsLeft(viewer.id, viewer.anonymous);
  } catch (err) {
    logger.error("uploadsLeft failed", { error: String(err) });
    return null;
  }
}

export default async function HomePage({ searchParams }: { searchParams: Promise<Search> }) {
  const [viewer, params] = await Promise.all([getViewer(), searchParams]);
  // Same rule as getCreator(): a Google session with a confirmed email.
  const creator = viewer && !viewer.anonymous && viewer.email ? { id: viewer.id, email: viewer.email } : null;
  const left = await allowance(viewer);
  const resume = typeof params.resume === "string" && isUuid(params.resume) ? params.resume : null;
  return (
    // Phone: one left-aligned column, 20 px gutter. ≥1024: 12-col grid, 40 px gutters (see AREA).
    <main className="mx-auto flex min-h-dvh w-full max-w-[1280px] flex-col gap-8 px-5 pt-6 lg:grid lg:grid-cols-12 lg:grid-rows-[auto_auto_auto_auto_auto_1fr] lg:gap-x-10 lg:gap-y-0 lg:px-10 lg:pt-8">
      <div className="flex flex-col items-center gap-3 lg:col-span-6 lg:row-start-1 lg:items-start">
        <Logo size="xs" />
        {/* After DELETE /api/account: the session is already gone. */}
        {!creator && params.deleted === "1" && (
          <p role="status" className="text-sm font-semibold text-ink">
            Your account is gone.
          </p>
        )}
      </div>
      {/* The form components draw the headline, the clip and the button for their own state. */}
      {!creator ? (
        <Landing authFailed={params.auth === "failed"} uploadsLeft={left} />
      ) : (
        <CreatorUpload creator={creator} resume={resume} uploadsLeft={left} />
      )}
      <footer className={`mt-auto pb-4 text-[12px] text-muted ${AREA.footer}`}>
        {creator && (
          <p className="mb-2">
            Your video is stored by Songfit and analyzed with third-party AI services to find your songs.
          </p>
        )}
        <span>Songfit</span>
        <span aria-hidden> · </span>
        <a href="/privacy" className="inline-flex min-h-11 items-center underline underline-offset-2">
          Privacy
        </a>
        <span aria-hidden> · </span>
        <span>Song previews by Deezer</span>
      </footer>
    </main>
  );
}
