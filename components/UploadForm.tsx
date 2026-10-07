export default function UploadForm() {
  return (
    <form className="mt-10 flex w-full max-w-md flex-col gap-4" aria-disabled>
      <div className="flex h-44 w-full items-center justify-center rounded-3xl border border-dashed border-steel-light bg-white text-sm text-muted">
        Tap to choose a video
      </div>
      <input
        type="text"
        disabled
        placeholder="What do you want this to feel like? (optional)"
        className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-base"
      />
      <button
        type="button"
        disabled
        className="steel-gradient w-full rounded-2xl px-6 py-4 text-base font-semibold text-white opacity-60"
      >
        Find my songs
      </button>
      <p className="text-center text-xs text-muted">
        Your video is processed by AI services to find songs and kept so you can come back to your results.
      </p>
    </form>
  );
}
