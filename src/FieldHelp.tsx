import { Tooltip } from "./Tooltip";

export function FieldHelp({ label, hint }: { label: string; hint: string }) {
  return <Tooltip label={hint} side="top">
    <button type="button" aria-label={`${label}: ${hint}`} className="inline-flex size-5 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-white/10 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="size-3.5" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><circle cx="12" cy="7" r="0.75" fill="currentColor" stroke="none" />
      </svg>
    </button>
  </Tooltip>;
}
