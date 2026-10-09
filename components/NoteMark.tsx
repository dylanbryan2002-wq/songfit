/** The red eighth-note mark from components/Logo.tsx, sized in px for next/og images (icons, share card). */
export const BRAND = "#E0262B";
export const INK = "#0F1419";
export const CANVAS = "#F7F8FA";

export function NoteMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={BRAND}>
      <ellipse cx="8" cy="18" rx="4.2" ry="3.1" transform="rotate(-20 8 18)" />
      <rect x="11.2" y="3" width="2.3" height="15.5" rx="1" />
      <path d="M13.5 3c0 3.2 2.4 4.1 4.3 5.6 1.9 1.5 2.4 3.6 1.4 5.9-.1-2.2-1.4-3.2-3.1-4.1-1.8-1-2.6-2-2.6-4.2V3Z" />
    </svg>
  );
}
