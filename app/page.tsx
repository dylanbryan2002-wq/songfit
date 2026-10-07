import { getCreator } from "@/src/auth/session";
import { Logo } from "@/components/Logo";
import { SignIn } from "@/components/SignIn";
import { UploadForm } from "@/components/UploadForm";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const creator = await getCreator();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col items-center px-5 pb-16 pt-10">
      <Logo className="text-2xl" />
      <h1 className="mt-12 text-center text-4xl font-semibold leading-tight tracking-tight">
        Find the right song for your content.
      </h1>
      <p className="mt-4 max-w-sm text-center text-base text-muted">
        Upload your Reel and Songfit will find the songs that fit it best, and exactly which part to use.
      </p>
      {creator ? <UploadForm creator={creator} /> : <SignIn />}
    </main>
  );
}
