import { getCreator } from "@/src/auth/session";
import { isUuid } from "@/src/shared/ids";
import { Logo } from "@/components/Logo";
import { UploadForm } from "@/components/UploadForm";
import { AREA } from "@/components/landing/Hero";
import { Landing } from "@/components/landing/Landing";
import { ResumeUpload } from "@/components/landing/ResumeUpload";

export const dynamic = "force-dynamic";

type Search = { resume?: string | string[]; auth?: string | string[] };

export default async function HomePage({ searchParams }: { searchParams: Promise<Search> }) {
  const [creator, params] = await Promise.all([getCreator(), searchParams]);
  const resume = typeof params.resume === "string" && isUuid(params.resume) ? params.resume : null;
  return (
    // Phone: one left-aligned column, 20 px gutter. ≥1024: 12-col grid, 40 px gutters (see AREA).
    <main className="mx-auto flex min-h-dvh w-full max-w-[1280px] flex-col gap-8 px-5 pt-6 lg:grid lg:grid-cols-12 lg:grid-rows-[auto_auto_auto_auto_auto_1fr] lg:gap-x-10 lg:gap-y-0 lg:px-10 lg:pt-8">
      <div className="lg:col-span-6 lg:row-start-1">
        <Logo size="xs" />
      </div>
      {/* The form components draw the headline, the clip and the button for their own state. */}
      {!creator ? (
        <Landing authFailed={params.auth === "failed"} />
      ) : resume ? (
        <ResumeUpload creator={creator} flowId={resume} />
      ) : (
        <UploadForm creator={creator} />
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
