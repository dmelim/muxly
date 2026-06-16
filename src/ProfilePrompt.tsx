import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";

type Props = {
  // Existing profile names, for the case-insensitive duplicate check.
  existingNames: string[];
  // Creates the profile (and switches to it). Resolves on success; rejects with
  // a message we surface inline.
  onCreate: (name: string) => Promise<void>;
  onClose: () => void;
};

// Small themed modal for creating a profile, in place of the browser's native
// prompt. Matches the command palette / search look. Enter creates, Esc closes.
export function ProfilePrompt({ existingNames, onCreate, onClose }: Props) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = name.trim();
  const duplicate = existingNames.some(
    (existing) => existing.trim().toLowerCase() === trimmed.toLowerCase()
  );

  const submit = async () => {
    if (!trimmed) return;
    if (duplicate) {
      setError(`A profile named "${trimmed}" already exists.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate(trimmed);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-24"
      onClick={onClose}
    >
      <div
        className="w-[420px] overflow-hidden rounded-lg border border-white/10 bg-[#15181d] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="New profile"
      >
        <div className="border-b border-white/10 px-5 py-4">
          <h2 className="text-sm font-semibold text-zinc-100">New profile</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Group services and switch the sidebar to show one at a time.
          </p>
        </div>

        <div className="p-5">
          <label
            htmlFor="new-profile-name"
            className="mb-1.5 block text-xs uppercase tracking-[0.14em] text-zinc-500"
          >
            Profile name
          </label>
          <input
            id="new-profile-name"
            ref={inputRef}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
            className="form-input"
            placeholder="e.g. Day job"
            aria-label="Profile name"
            disabled={busy}
          />
          {error ? (
            <p className="mt-2 rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-white/10 px-5 py-3">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void submit()}
            disabled={busy || !trimmed || duplicate}
          >
            {busy ? "Creating…" : "Create profile"}
          </Button>
        </div>
      </div>
    </div>
  );
}
