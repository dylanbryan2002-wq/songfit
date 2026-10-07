import Link from "next/link";
import { Logo } from "@/components/Logo";

export const metadata = { title: "Privacy · Songfit" };

const CONTACT = "dylanbryan2002@gmail.com";

/** Plain-language privacy policy. Required by Google's OAuth consent screen to publish the app. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 pb-16 pt-10">
      <Link href="/" aria-label="Songfit home">
        <Logo className="text-2xl" />
      </Link>
      <h1 className="mt-10 text-3xl font-semibold tracking-tight">Privacy</h1>
      <p className="mt-2 text-sm text-muted">Last updated 7 October 2026</p>

      <section className="mt-8 space-y-6 text-[15px] leading-relaxed text-ink/90">
        <p>
          Songfit finds songs for your short videos. This page says what we collect, what we do with it, and how to
          get it deleted. It is written to be read, not to cover us.
        </p>

        <div>
          <h2 className="font-semibold">What we collect</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Your Google account email and name, when you sign in with Google. We use them to know whose videos are whose.</li>
            <li>The videos you upload, and the optional note about how the video should feel.</li>
            <li>What you do on the site: uploads, which songs you listen to, choose, or reject. This is how we learn whether the recommendations are any good.</li>
          </ul>
        </div>

        <div>
          <h2 className="font-semibold">What we do with your video</h2>
          <p className="mt-2">
            To recommend songs we look at frames from your video and listen to any speech in it. That analysis is done
            by third-party AI services (Anthropic and OpenAI) under their business terms, which do not allow them to
            train on your content. Song details and 30-second samples come from Deezer. Your video is stored on
            Supabase and the site runs on Vercel.
          </p>
        </div>

        <div>
          <h2 className="font-semibold">What we don&apos;t do</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>We don&apos;t sell your data or your videos.</li>
            <li>We don&apos;t post anything to TikTok or Instagram for you.</li>
            <li>We don&apos;t show your video to other creators.</li>
          </ul>
        </div>

        <div>
          <h2 className="font-semibold">How long we keep it</h2>
          <p className="mt-2">
            We keep your videos and results so you can come back to them. Email {CONTACT} and we will delete your
            videos, your results, and your account within a few days.
          </p>
        </div>

        <div>
          <h2 className="font-semibold">Payments</h2>
          <p className="mt-2">
            If you subscribe, payment is handled by Stripe. We never see your card number.
          </p>
        </div>

        <div>
          <h2 className="font-semibold">Contact</h2>
          <p className="mt-2">Questions or deletion requests: {CONTACT}</p>
        </div>
      </section>
    </main>
  );
}
