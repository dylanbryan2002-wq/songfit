"use client";
import { useState } from "react";
import { DELETE_FAILED } from "./DeleteVideoButton";

export const CONFIRM_WORD = "DELETE";
export const WAIT_FOR_RUNS = "Wait for your current video to finish.";

export function deleteAccountError(status: number): string {
  return status === 409 ? WAIT_FOR_RUNS : DELETE_FAILED;
}

/** Stateless: "Delete my account", or the typed-DELETE panel. */
export function DeleteAccountView({
  open,
  value,
  busy,
  error,
  onOpen,
  onChange,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  value: string;
  busy: boolean;
  error: string | null;
  onOpen: () => void;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  if (!open) {
    return (
      <button type="button" onClick={onOpen} className="min-h-11 self-start text-xs font-semibold text-red-600 underline underline-offset-2">
        Delete my account
      </button>
    );
  }
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value === CONFIRM_WORD && !busy) onSubmit();
      }}
    >
      <label htmlFor="delete-confirm" className="text-ink">
        This removes your videos, songs and account. Type DELETE to confirm.
      </label>
      <input
        id="delete-confirm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoCapitalize="characters"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        className="min-h-11 rounded-xl px-3 text-base text-ink ring-1 ring-inset ring-ink/20"
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={value !== CONFIRM_WORD || busy}
          className="min-h-11 rounded-full border border-red-600 px-4 text-sm font-semibold text-red-600 disabled:opacity-40"
        >
          Delete everything
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="min-h-11 px-2 text-sm font-semibold text-ink disabled:opacity-40">
          Keep my account
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}

/** "Delete my account" on /account. On success the server has signed out; a full load lands on the notice. */
export function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const status = await fetch("/api/account", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: CONFIRM_WORD }),
    })
      .then((r) => r.status)
      .catch(() => 0);
    if (status === 204) {
      window.location.assign("/?deleted=1");
      return;
    }
    setError(deleteAccountError(status));
    setBusy(false);
  }

  return (
    <DeleteAccountView
      open={open}
      value={value}
      busy={busy}
      error={error}
      onOpen={() => setOpen(true)}
      onChange={setValue}
      onSubmit={() => void submit()}
      onCancel={() => {
        setOpen(false);
        setValue("");
        setError(null);
      }}
    />
  );
}
