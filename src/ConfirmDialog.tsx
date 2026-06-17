import { useEffect } from "react";
import { Button } from "./Button";

type Props = {
  title: string;
  // Body text explaining what will happen. Plain string so callers stay simple.
  message: string;
  // Label for the confirming action (e.g. "Delete"). Defaults to "Confirm".
  confirmLabel?: string;
  // When true, the confirm button uses the destructive (rose) styling.
  destructive?: boolean;
  // Disables both buttons while the confirmed action is in flight.
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

// Small themed confirmation modal, in place of the browser's native
// `window.confirm` (whose OS chrome clashes with the dark, cyan-accented UI —
// see agents.md). Matches the ProfilePrompt look. Enter confirms, Esc cancels.
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  destructive = false,
  busy = false,
  onConfirm,
  onClose
}: Props) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (busy) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Enter") {
        event.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onConfirm, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-24"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="w-[420px] overflow-hidden rounded-lg border border-white/10 bg-[#15181d] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="border-b border-white/10 px-5 py-4">
          <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
        </div>

        <div className="px-5 py-4">
          <p className="text-sm text-zinc-300">{message}</p>
        </div>

        <div className="flex justify-end gap-2 border-t border-white/10 px-5 py-3">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "primary"}
            size="sm"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
