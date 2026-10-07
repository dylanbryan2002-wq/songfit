/** Wordmark. Named export: `import { Logo } from "@/components/Logo"`. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline font-semibold tracking-tight ${className}`} aria-label="Songfit">
      <span className="text-ink">Song</span>
      <span className="steel-text">fit</span>
    </span>
  );
}
