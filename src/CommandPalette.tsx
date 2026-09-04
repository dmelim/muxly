import { useEffect, useMemo, useRef, useState } from "react";
import { fuzzySearchScore } from "./search";

/** A single palette action. `run` is invoked on selection; the palette closes
 * itself afterwards. `keywords` widen what the fuzzy filter matches. */
export type Command = {
  id: string;
  title: string;
  subtitle?: string;
  /** Right-aligned hint, e.g. the current state of a toggle ("On"/"Off"). */
  badge?: string;
  keywords?: string;
  run: () => void;
};

type Props = {
  commands: Command[];
  onClose: () => void;
};

/**
 * Lightweight command palette. Invoked from the toolbar or Ctrl/Cmd+P, it lists
 * named actions resolved from a registry the parent passes in. Type to filter,
 * ↑/↓ to move, Enter to run, Esc to close. Styled to match GlobalSearch.
 */
export function CommandPalette({ commands, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    return commands
      .flatMap((command, index) => {
        const score = fuzzySearchScore(query, [
          command.title,
          command.subtitle,
          command.keywords
        ]);
        return score === null ? [] : [{ command, index, score }];
      })
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map(({ command }) => command);
  }, [commands, query]);

  // Keep the selection in range as the filtered list shrinks/grows.
  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Scroll the active row into view as the user arrows through.
  useEffect(() => {
    const list = listRef.current;
    const node = list?.children[activeIndex] as HTMLElement | undefined;
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const runAt = (index: number) => {
    const command = filtered[index];
    if (!command) return;
    command.run();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-24"
      onClick={onClose}
    >
      <div
        className="flex max-h-[60vh] w-[560px] flex-col overflow-hidden rounded-lg border border-white/10 bg-[#15181d] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-3">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((current) => Math.min(current + 1, filtered.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) => Math.max(current - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                runAt(activeIndex);
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
            placeholder="Run a command…"
            aria-label="Run a command"
            className="form-input"
          />
          <p className="mt-1.5 px-1 text-[11px] text-zinc-500">
            ↑↓ to move · Enter to run · Esc to close
          </p>
        </div>

        <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto border-t border-white/10 p-2">
          {filtered.length === 0 ? (
            <li className="px-2 py-3 text-xs text-zinc-500">No matching command.</li>
          ) : null}
          {filtered.map((command, index) => {
            const active = index === activeIndex;
            return (
              <li key={command.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => runAt(index)}
                  className={`flex w-full items-center justify-between gap-3 rounded px-2.5 py-2 text-left transition ${
                    active ? "bg-white/10 text-zinc-100" : "text-zinc-300 hover:bg-white/5"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{command.title}</span>
                    {command.subtitle ? (
                      <span className="block truncate text-[11px] text-zinc-500">
                        {command.subtitle}
                      </span>
                    ) : null}
                  </span>
                  {command.badge ? (
                    <span className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-400">
                      {command.badge}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
