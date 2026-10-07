/** Deezer attribution for the samples. Links to the playing song's Deezer page when there is one. */
export function Attribution({ href }: { href: string | null }) {
  return (
    <p className="text-center text-xs text-muted">
      Samples via{" "}
      <a
        href={href ?? "https://www.deezer.com"}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-steel-dark underline underline-offset-2"
      >
        Deezer
      </a>
    </p>
  );
}
