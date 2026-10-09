import { HEADLINE, MONO_LINE, PICK_A_FEEL, SUBLINE } from "./copy";

/** Where each block sits. Phone: one centred column in DOM order (main is a flex column; Dylan 2026-10-09).
 *  ≥1024: main is a 12-col grid; text in cols 1–6, the clip in cols 8–12, top-aligned with the H1.
 *  Rows: 1 logo · 2 heading · 3 body · 4 note · 5 footer · 6 filler (takes the clip's extra height). */
export const AREA = {
  heading: "text-center lg:text-left lg:col-span-6 lg:col-start-1 lg:row-start-2 lg:mt-10",
  media: "mx-auto lg:mx-0 lg:col-span-5 lg:col-start-8 lg:row-span-5 lg:row-start-2 lg:mt-10",
  body: "text-center lg:text-left lg:col-span-6 lg:col-start-1 lg:row-start-3 lg:mt-10",
  note: "text-center lg:text-left lg:col-span-6 lg:col-start-1 lg:row-start-4 lg:mt-4",
  footer: "text-center lg:text-left lg:col-span-6 lg:col-start-1 lg:row-start-5 lg:mt-10",
} as const;

/** The one button style: "Choose your video" and "Find my songs". */
export const CTA =
  "h-14 w-full rounded-md bg-ink px-6 text-[16px] font-semibold text-white disabled:opacity-60 lg:w-auto lg:px-8";
/** The CTA's bar: sticky to the bottom on a phone, clear of the home indicator; inline on a laptop. */
export const CTA_BAR =
  "z-10 -mx-5 flex flex-col gap-3 bg-canvas px-5 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-3 lg:static lg:mx-0 lg:items-start lg:px-0 lg:pb-0 lg:pt-0";
export const STICKY = `sticky bottom-0 ${CTA_BAR}`;

const DISPLAY = "font-display font-extrabold text-ink [font-variation-settings:'wdth'_85]";

/** H1, mono line, subline. */
export function Headline() {
  return (
    <div className={AREA.heading}>
      <h1
        className={`${DISPLAY} text-[44px] leading-[1.02] tracking-[-0.01em] lg:text-[clamp(64px,6.5vw,88px)] lg:leading-[0.95]`}
      >
        {HEADLINE}
      </h1>
      <p className="mt-4 font-mono text-[15px] font-medium leading-[1.3] tracking-wide text-ink">{MONO_LINE}</p>
      <p className="mx-auto mt-3 max-w-[32ch] text-[16px] leading-[1.45] text-muted lg:mx-0">{SUBLINE}</p>
    </div>
  );
}

/** Chosen-video heading (signed-in form). */
export function PickAFeel() {
  return (
    <div className={AREA.heading}>
      <h1 className={`${DISPLAY} text-[32px] leading-[1.02] tracking-[-0.01em]`}>{PICK_A_FEEL}</h1>
    </div>
  );
}

/** A 9:16 media box (square corners, no frame, left-aligned) with a mono caption under a hairline. */
export function MediaFrame({
  size,
  children,
  caption,
}: {
  /** Height classes; the width follows from 9:16. */
  size: string;
  children: React.ReactNode;
  caption: React.ReactNode;
}) {
  return (
    <figure className={AREA.media}>
      <div className={`relative aspect-[9/16] max-w-full overflow-hidden bg-ink ${size}`}>{children}</div>
      <figcaption className="mt-3 border-t border-ink/15 pt-3 font-mono text-[12px] font-medium tracking-wide text-ink">
        {caption}
      </figcaption>
    </figure>
  );
}

export const DEMO_SIZE = "h-[min(60svh,480px)] lg:h-[min(72svh,640px)]";
export const CHOSEN_SIZE = "h-[260px]";
