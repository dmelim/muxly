import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ServiceConfig } from "./types";

type Props = {
  services: ServiceConfig[];
  /** Snapshot of per-service log chunks (logsRef.current). */
  logs: Record<string, string[]>;
  onJump: (serviceId: string) => void;
  onClose: () => void;
};

type Hit = { lineNumber: number; line: string };
type ServiceHits = {
  serviceId: string;
  serviceName: string;
  hits: Hit[];
  total: number;
};

// Strip CSI escape sequences (colors, cursor moves) so searches and the
// rendered results work on plain text.
const ANSI = /\[[0-9;]*[A-Za-z]/g;
const MIN_QUERY = 2;
const MAX_HITS_PER_SERVICE = 25;

// How often to re-scan the live log buffers while the modal is open.
// The `logs` prop is the same Record reference every render (it's
// `logsRef.current`), so React can't tell us when new chunks arrive — we
// poll instead. 250ms feels responsive without burning CPU on idle apps.
const LIVE_REFRESH_MS = 250;

export function GlobalSearch({ services, logs, onJump, onClose }: Props) {
  const [query, setQuery] = useState("");
  // Tick bumps on a timer while a query is active. It's a useMemo dep below,
  // which is what gives global search its "live" feel — new chunks streamed
  // into logsRef during a long-running service become searchable without
  // the user having to retype.
  const [tick, setTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (query.trim().length < MIN_QUERY) return;
    const id = window.setInterval(() => setTick((t) => t + 1), LIVE_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [query]);

  const results = useMemo<ServiceHits[]>(() => {
    // `tick` is intentionally read here so the memo invalidates on each
    // poll — even though we don't use its value, listing it as a dep is
    // what couples the search to the polling timer.
    void tick;
    const needle = query.trim().toLowerCase();
    if (needle.length < MIN_QUERY) {
      return [];
    }

    const out: ServiceHits[] = [];
    for (const service of services) {
      const chunks = logs[service.id];
      if (!chunks || chunks.length === 0) {
        continue;
      }

      const lines = chunks.join("").replace(ANSI, "").split(/\r?\n/);
      const hits: Hit[] = [];
      let total = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(needle)) {
          total += 1;
          if (hits.length < MAX_HITS_PER_SERVICE) {
            hits.push({ lineNumber: i + 1, line: lines[i] });
          }
        }
      }

      if (total > 0) {
        out.push({ serviceId: service.id, serviceName: service.name, hits, total });
      }
    }
    return out;
  }, [query, services, logs, tick]);

  const totalMatches = results.reduce((sum, result) => sum + result.total, 0);
  const trimmed = query.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-24"
      onClick={onClose}
    >
      <div
        className="flex max-h-[68vh] w-[640px] flex-col overflow-hidden rounded-lg border border-white/10 bg-[#15181d] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-white/10 p-3">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search all service logs…"
            className="form-input"
          />
          <p className="mt-1.5 px-1 text-[11px] text-zinc-500">
            {trimmed.length < MIN_QUERY
              ? "Type at least 2 characters. Esc to close."
              : `${totalMatches} match${totalMatches === 1 ? "" : "es"} across ${
                  results.length
                } service${results.length === 1 ? "" : "s"}`}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {trimmed.length >= MIN_QUERY && results.length === 0 ? (
            <p className="px-2 py-3 text-xs text-zinc-500">No matches.</p>
          ) : null}

          {results.map((result) => (
            <div key={result.serviceId} className="mb-3">
              <p className="px-2 py-1 text-xs font-semibold text-zinc-300">
                {result.serviceName}
                {result.total > result.hits.length ? (
                  <span className="ml-1 font-normal text-zinc-500">
                    (showing {result.hits.length} of {result.total})
                  </span>
                ) : null}
              </p>
              <ul>
                {result.hits.map((hit, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      onClick={() => {
                        onJump(result.serviceId);
                        onClose();
                      }}
                      className="block w-full truncate rounded px-2 py-1 text-left font-mono text-xs text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
                    >
                      <span className="mr-2 text-zinc-600">{hit.lineNumber}</span>
                      {highlight(hit.line, trimmed)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Wrap case-insensitive matches of `query` in <mark> for display.
function highlight(line: string, query: string): ReactNode {
  if (!query) {
    return line;
  }

  const haystack = line.toLowerCase();
  const needle = query.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  while (cursor < line.length) {
    const index = haystack.indexOf(needle, cursor);
    if (index === -1) {
      parts.push(line.slice(cursor));
      break;
    }
    if (index > cursor) {
      parts.push(line.slice(cursor, index));
    }
    parts.push(
      <mark key={key++} className="rounded-sm bg-amber-400/30 text-amber-100">
        {line.slice(index, index + needle.length)}
      </mark>
    );
    cursor = index + needle.length;
  }

  return parts;
}
