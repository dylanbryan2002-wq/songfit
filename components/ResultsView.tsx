import type { ReactNode } from "react";
import { RecommendationCard, type Rank } from "@/components/RecommendationCard";
import type { RecommendationView } from "@/src/shared/types";

export type ResultsViewProps = {
  submission: { id: string };
  recommendations: RecommendationView[];
  onSelect?: (rank: Rank) => void;
  onReject?: (rank: Rank) => void;
  children?: ReactNode;
};

// Presentational and server-renderable. Phase 4 WRAPS this component in a client component that
// supplies real handlers and server-seeded state; it must not replace the heading or footer.
// Handlers are no-ops until then.
export function ResultsView({ submission, recommendations, onSelect, onReject, children }: ResultsViewProps) {
  const noop = () => {};
  return (
    <section className="w-full" data-submission-id={submission.id}>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Your Songfit</h1>
      <div className="mt-6 flex flex-col gap-4">
        {recommendations.map((rec) => (
          <RecommendationCard
            key={rec.rank}
            rec={rec}
            chosen={rec.selected}
            collapsed={false}
            onSelect={onSelect ?? noop}
            onReject={onReject ?? noop}
          />
        ))}
      </div>
      {children}
      <p className="mt-8 text-center text-xs text-muted">Sections are our best estimate. Check it against the track.</p>
    </section>
  );
}
