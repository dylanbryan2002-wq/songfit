/** Deezer attribution for the samples and the estimate note. Links to the playing song's Deezer page when there is one. */
export function Attribution({ href }: { href: string | null }) {
  return (
    <div className="text-center text-xs text-muted">
      <p>
        Samples via{" "}
        <a
          href={href ?? "https://www.deezer.com"}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-steel-dark underline-offset-2 hover:underline"
        >
          Deezer
        </a>
      </p>
      <p className="mt-1">Sections are our best estimate. Check it against the track.</p>
    </div>
  );
}
