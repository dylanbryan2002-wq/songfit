/**
 * Songfit logo (mark + wordmark), from Dylan's brand file in `public/brand/`.
 * `mix-blend-multiply` lets the JPEG's off-white background disappear into any light page background;
 * swap the file for an SVG/transparent PNG when one exists and drop the blend.
 * Named export: `import { Logo } from "@/components/Logo"`.
 */
export function Logo({ size = "sm", className = "" }: { size?: "sm" | "lg"; className?: string }) {
  const height = size === "lg" ? "h-10" : "h-7";
  return (
    <span className={`inline-flex items-center ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset, no optimisation needed */}
      <img
        src="/brand/songfit-logo.jpg"
        alt="Songfit"
        width={540}
        height={200}
        className={`${height} w-auto select-none mix-blend-multiply`}
        draggable={false}
      />
    </span>
  );
}
