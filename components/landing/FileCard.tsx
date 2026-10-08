import { formatDuration, formatFileSize } from "../videoChecks";

/** The chosen video: name · length · size, with a way to pick another. */
export function FileCard({
  name,
  durationSeconds,
  size,
  onChange,
  disabled,
}: {
  name: string;
  durationSeconds: number | null;
  size: number;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white py-1 pl-4 pr-1">
      <div className="min-w-0 flex-1 py-2">
        <p className="truncate text-sm font-semibold text-ink">{name}</p>
        <p className="text-xs text-muted">
          {formatDuration(durationSeconds)} · {formatFileSize(size)}
        </p>
      </div>
      <button
        type="button"
        onClick={onChange}
        disabled={disabled}
        className="min-h-11 shrink-0 rounded-xl px-4 text-sm font-semibold text-steel-dark disabled:opacity-50"
      >
        Change
      </button>
    </div>
  );
}
