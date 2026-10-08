import { getCreator } from "@/src/auth/session";
import { Logo } from "@/components/Logo";
import { SignIn } from "@/components/SignIn";
import { UploadForm } from "@/components/UploadForm";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const creator = await getCreator();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col items-center px-5 pb-16 pt-10">
      <Logo size="lg" />
      <h1 className="mt-12 text-center text-4xl font-semibold leading-tight tracking-tight">
        Find the right song for your content.
      </h1>
      <p className="mt-4 max-w-sm text-center text-base text-muted">
        Upload your Reel and Songfit will find the songs that fit it best, and exactly which part to use.
      </p>
      {creator ? <UploadForm creator={creator} /> : <SignIn />}
      <p className="mt-6 text-center text-xs text-neutral-500">
        Your video is stored by Songfit and analyzed with third-party AI services to find your songs.{" "}
        <a href="/privacy" className="underline underline-offset-2">
          How we handle it, and how to delete it.
        </a>
      </p>
    </main>
  );
}
