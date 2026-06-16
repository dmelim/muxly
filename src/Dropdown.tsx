import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, ChevronDownIcon } from "./icons";

export type DropdownOption = {
  value: string;
  label: string;
  // Optional leading glyph shown in both the trigger and the option row.
  icon?: ReactNode;
};

type Props = {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  // Shown in the trigger when no option matches `value`.
  placeholder?: string;
  // Extra classes for the positioning wrapper.
  className?: string;
  // "field" blends into form inputs (matches .form-input); "toolbar" is the
  // lighter sidebar/header look.
  variant?: "field" | "toolbar";
};

// The app's single themed dropdown. A native <select>'s option list is
// OS-rendered and can't match the dark, cyan-accented design, so this renders
// its own button + popover: click-outside and Esc close, ↑/↓ + Enter navigate,
// the selected option carries a cyan check. Use this instead of <select>.
export function Dropdown({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder,
  className,
  variant = "field"
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find((option) => option.value === value);
  const textSize = variant === "toolbar" ? "text-sm" : "text-[0.8125rem]";
  const triggerBg =
    variant === "toolbar" ? "bg-white/5 hover:bg-white/10" : "bg-black/25 hover:bg-white/5";

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  const openMenu = () => {
    const index = options.findIndex((option) => option.value === value);
    setActiveIndex(index < 0 ? 0 : index);
    setOpen(true);
  };

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (!open) openMenu();
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={`flex w-full items-center justify-between gap-2 rounded-md border border-white/10 px-2.5 py-2 text-left ${textSize} text-zinc-200 transition ${triggerBg} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected?.icon ? (
            <span className="shrink-0 text-zinc-400">{selected.icon}</span>
          ) : null}
          <span className={`truncate ${selected ? "" : "text-zinc-500"}`}>
            {selected?.label ?? placeholder ?? ""}
          </span>
        </span>
        <ChevronDownIcon
          className={`size-4 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <ul
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={-1}
          ref={(node) => node?.focus()}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((current) => Math.min(current + 1, options.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              const option = options[activeIndex];
              if (option) choose(option.value);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
            }
          }}
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-md border border-white/10 bg-[#18181b] p-1 shadow-lg focus:outline-none"
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const highlighted = index === activeIndex;
            return (
              <li key={option.value} role="option" aria-selected={isSelected}>
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(option.value)}
                  className={`flex w-full items-center justify-between gap-2 rounded px-2.5 py-2 text-left ${textSize} transition ${
                    highlighted ? "bg-white/10 text-zinc-100" : "text-zinc-300"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {option.icon ? (
                      <span className="shrink-0 text-zinc-400">{option.icon}</span>
                    ) : null}
                    <span className="truncate">{option.label}</span>
                  </span>
                  {isSelected ? (
                    <CheckIcon className="size-4 shrink-0 text-cyan-400" />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
