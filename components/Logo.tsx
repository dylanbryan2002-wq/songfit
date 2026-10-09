/**
 * Songfit logo: a red note mark and the wordmark "Song" (ink) + "fit" (red), drawn inline so it is
 * crisp at any size and needs no image file. Dylan 2026-10-09: "fit" red, red in the mark.
 * Named export: `import { Logo } from "@/components/Logo"`.
 */
export function Logo({ size = "sm", className = "" }: { size?: "xs" | "sm" | "lg"; className?: string }) {
  const mark = size === "lg" ? "h-9 w-9" : size === "xs" ? "h-5 w-5" : "h-6 w-6";
  const text = size === "lg" ? "text-[32px]" : size === "xs" ? "text-[19px]" : "text-[22px]";
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} aria-label="Songfit" role="img">
      <svg aria-hidden viewBox="0 0 24 24" className={`${mark} shrink-0 text-brand`} fill="currentColor">
        {/* Eighth note: head, stem, flag. */}
        <ellipse cx="8" cy="18" rx="4.2" ry="3.1" transform="rotate(-20 8 18)" />
        <rect x="11.2" y="3" width="2.3" height="15.5" rx="1" />
        <path d="M13.5 3c0 3.2 2.4 4.1 4.3 5.6 1.9 1.5 2.4 3.6 1.4 5.9-.1-2.2-1.4-3.2-3.1-4.1-1.8-1-2.6-2-2.6-4.2V3Z" />
      </svg>
      <span className={`${text} font-display font-extrabold leading-none tracking-[-0.02em] [font-variation-settings:'wdth'_90]`}>
        <span className="text-ink">Song</span>
        <span className="text-brand">fit</span>
      </span>
    </span>
  );
}
