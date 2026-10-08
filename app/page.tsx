import { getCreator } from "@/src/auth/session";
import { isUuid } from "@/src/shared/ids";
import { Logo } from "@/components/Logo";
import { UploadForm } from "@/components/UploadForm";
import { DemoLoop } from "@/components/landing/DemoLoop";
import { Landing } from "@/components/landing/Landing";
import { ResumeUpload } from "@/components/landing/ResumeUpload";

export const dynamic = "force-dynamic";

type Search = { resume?: string | string[]; auth?: string | string[] };

export default async function HomePage({ searchParams }: { searchParams: Promise<Search> }) {
  const [creator, params] = await Promise.all([getCreator(), searchParams]);
  const resume = typeof params.resume === "string" && isUuid(params.resume) ? params.resume : null;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col items-center px-5 pb-10 pt-6">
      <Logo size="lg" />
      <h1 className="mt-5 text-center text-3xl font-semibold leading-tight tracking-tight">
        We find the perfect song to help your video go viral.
      </h1>
      {/* Back from Google with a kept file: the clip and "Find my songs" come first, no demo. */}
      {!(creator && resume) && (
        <div className="mt-5 w-full">
          <DemoLoop />
        </div>
      )}
      <div className="mt-5 flex w-full flex-col items-center">
        {!creator ? (
          <Landing authFailed={params.auth === "failed"} />
        ) : resume ? (
          <ResumeUpload creator={creator} flowId={resume} />
        ) : (
          <UploadForm creator={creator} />
        )}
      </div>
      {creator && (
        <p className="mt-2 text-center text-xs text-neutral-500">
          Your video is stored by Songfit and analyzed with third-party AI services to find your songs.
        </p>
      )}
      <footer className="mt-auto pt-8 text-center text-xs text-muted">
        <a href="/privacy" className="inline-block min-h-11 py-3 underline underline-offset-2">
          Privacy
        </a>
        <span aria-hidden> · </span>
        <span>Samples via Deezer</span>
      </footer>
    </main>
  );
}
