import Link from "next/link";
import { Logo } from "@/components/Logo";
import { CONTACT_EMAIL as CONTACT } from "@/src/shared/config";

export const metadata = { title: "Privacy · Songfit" };

/** Plain-language privacy policy. Required by Google's OAuth consent screen to publish the app. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 pb-16 pt-10">
      <Link href="/" aria-label="Songfit home">
        <Logo size="lg" />
      </Link>
      <h1 className="mt-10 text-3xl font-semibold tracking-tight">Privacy</h1>
      <p className="mt-2 text-sm text-muted">Last updated 8 October 2026</p>

      <section className="mt-8 space-y-6 text-[15px] leading-relaxed text-ink/90">
        <p>
          Songfit finds songs for your short videos. This page says what we collect, who handles it, and how to get
          it deleted.
        </p>

        <div>
          <h2 className="font-semibold">What we collect</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Your Google account email and name, when you sign in with Google. We use them to know whose videos are whose.</li>
            <li>The videos you upload, the vibe you pick and the optional note about how the video should feel.</li>
            <li>What we work out from your video: still frames, a text transcript of any speech, and a written description of the video.</li>
            <li>What you do on the site: uploads, which songs you play, choose or reject, and anything you type in &quot;None of these?&quot;. This is how we learn whether the recommendations are any good.</li>
          </ul>
        </div>

        <div>
          <h2 className="font-semibold">Who handles it</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Google: sign-in.</li>
            <li>OpenAI (Whisper): turns any speech in your video into a transcript. It receives the audio track.</li>
            <li>Anthropic: analyses your video and matches songs to it. It receives the frames, the transcript, your vibe and your note.</li>
            <li>Deezer: checks that each song is real and supplies the 30-second samples, which play straight from Deezer, so Deezer sees your IP address.</li>
            <li>Supabase: stores your account, videos and results.</li>
            <li>Vercel: hosts the site.</li>
          </ul>
          <p className="mt-2">
            Anthropic and OpenAI handle your content under their API business terms, which do not allow them to train
            on it. Our hosting providers log IP addresses for security.
          </p>
        </div>

        <div>
          <h2 className="font-semibold">Before you sign in</h2>
          <p className="mt-2">
            You can upload before signing in. Your video is then kept under an anonymous account until you sign in
            with Google and see your songs. Anonymous uploads that are never claimed by signing in are deleted after
            30 days.
          </p>
          <p className="mt-2">
            If you pick a video and go to sign in first, a copy stays in your browser so the upload can continue
            afterwards. It is removed when the upload starts or when you change the file; otherwise it stays until you
            next open Songfit or clear this site&apos;s data.
          </p>
        </div>

        <div>
          <h2 className="font-semibold">What we don&apos;t do</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>We don&apos;t sell your data or your videos.</li>
            <li>We don&apos;t post anything to TikTok or Instagram for you.</li>
            <li>We never show your video or your results to other creators. The Songfit team can view them to fix problems.</li>
          </ul>
        </div>

        <div>
          <h2 className="font-semibold">How long we keep it</h2>
          <p className="mt-2">
            We keep your videos and results until you ask us to delete them, so you can come back to them. There is no
            automatic expiry yet. Email {CONTACT} and we will delete your videos, your results, and your account
            within a few days. Or delete them yourself on My Songfits.
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
