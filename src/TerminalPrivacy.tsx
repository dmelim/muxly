import type { ReactNode } from "react";

/** Keep xterm measurable and mounted, but inaccessible before the next paint. */
export function TerminalPrivacy({ concealed, children }: { concealed: boolean; children: ReactNode }) {
  return (
    <div className="relative h-full w-full">
      <div
        className="h-full w-full"
        style={{ visibility: concealed ? "hidden" : "visible" }}
        aria-hidden={concealed || undefined}
        inert={concealed || undefined}
        data-terminal-content
      >
        {children}
      </div>
      {concealed ? (
        <div role="status" className="absolute inset-0 flex items-center justify-center rounded-md border border-white/10 bg-[var(--muxly-terminal-bg)] p-3 text-center">
          <div className="max-w-sm space-y-2">
            <p className="text-sm font-medium text-zinc-200">Output hidden in Stream mode</p>
            <p className="text-xs text-zinc-400">The terminal session is preserved. Turn off Stream mode to view output and use terminal input.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
