import Link from "next/link";
import { Logo } from "./Logo";
import { SignOutButton } from "./SignOutButton";

/** The results page's layout while waiting; UploadForm draws the upload stage in the same one. */
export const WAITING_MAIN = "mx-auto flex min-h-dvh w-full max-w-md flex-col items-center gap-10 px-4 pb-10 pt-10";

/** Top bar of the results page, also drawn over the upload so the hand-off to results doesn't move. */
export function ResultsHeader({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <header className="flex w-full items-center justify-between">
      <Link href="/" aria-label="Songfit home">
        <Logo />
      </Link>
      <span className="flex flex-wrap items-center justify-end">
        <Link href="/" className="min-h-11 rounded-full px-2 text-sm font-semibold text-steel-dark">
          ← Upload another
        </Link>
        {signedIn && (
          <Link href="/account" className="min-h-11 rounded-full px-2 text-sm font-semibold text-steel-dark">
            My Songfits
          </Link>
        )}
        {signedIn && <SignOutButton className="!px-2" />}
      </span>
    </header>
  );
}
