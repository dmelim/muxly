import { createPortal } from "react-dom";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, ChevronDownIcon } from "./icons";

export type DropdownOption = {
  value: string;
  label: string;
  detail?: string;
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
  // Compact trigger for inspector/tool rows. The menu keeps the same keyboard
  // and accessibility behaviour while the trigger uses the shared icon size.
  compact?: boolean;
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
  variant = "field",
  compact = false
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const optionIdPrefix = useId();
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const selected = options.find((option) => option.value === value);
  const textSize = variant === "toolbar" ? "text-sm" : "text-[0.8125rem]";
  const triggerBg =
    variant === "toolbar" ? "bg-white/5 hover:bg-white/10" : "bg-black/25 hover:bg-white/5";

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    }
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  const updateMenuPosition = () => {
    const trigger = rootRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 8;
    const width = Math.min(
      Math.max(rect.width, compact ? 220 : 180),
      Math.max(0, window.innerWidth - viewportPadding * 2)
    );
    const menuHeight = menuRef.current?.offsetHeight ?? Math.min(256, Math.max(48, options.length * 40 + 8));
    const canOpenBelow = rect.bottom + 4 + menuHeight <= window.innerHeight - viewportPadding;
    const top = canOpenBelow
      ? rect.bottom + 4
      : Math.max(viewportPadding, rect.top - menuHeight - 4);
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding)
    );
    setMenuPosition((current) =>
      current && current.top === top && current.left === left && current.width === width
        ? current
        : { top, left, width }
    );
  };

  useLayoutEffect(() => {
    if (!open) {
      setMenuPosition(null);
      return;
    }
    updateMenuPosition();
    const onViewportChange = () => updateMenuPosition();
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open, options.length, compact]);

  // The first pass positions the portal with a bounded estimate. Once the
  // list is mounted, reposition from its real height so long labels never
  // cause the menu to open partly off-screen.
  useLayoutEffect(() => {
    if (open && menuPosition && menuRef.current) {
      updateMenuPosition();
    }
  }, [open, menuPosition, options.length, compact]);

  const menuMounted = open && menuPosition !== null;

  useEffect(() => {
    if (!menuMounted) return;
    menuRef.current?.focus();
  }, [menuMounted]);

  useEffect(() => {
    if (!open) return;
    const item = menuRef.current?.querySelector<HTMLElement>(
      `[data-dropdown-index="${activeIndex}"]`
    );
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, menuMounted]);

  useEffect(() => {
    setActiveIndex((current) => Math.max(0, Math.min(current, options.length - 1)));
  }, [options.length]);

  const openMenu = () => {
    const index = options.findIndex((option) => option.value === value);
    setActiveIndex(index < 0 ? 0 : index);
    setOpen(true);
  };

  const choose = (next: string) => {
    setOpen(false);
    onChange(next);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        ref={triggerRef}
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
        className={`flex items-center rounded-md border border-white/10 text-left ${textSize} text-zinc-200 transition ${triggerBg} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 ${compact ? "h-7 w-11 justify-center gap-1 px-1" : "w-full justify-between gap-2 px-2.5 py-2"}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected?.icon ? (
            <span className="shrink-0 text-zinc-400">{selected.icon}</span>
          ) : null}
          <span className={`${compact ? "sr-only" : "truncate"} ${selected ? "" : "text-zinc-500"}`}>
            {selected?.label ?? placeholder ?? ""}
          </span>
        </span>
        <ChevronDownIcon
          className={`${compact ? "size-3" : "size-4"} shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && menuPosition
        ? createPortal(
              <ul
                role="listbox"
                aria-label={ariaLabel}
                aria-activedescendant={
                  options.length > 0
                    ? `${optionIdPrefix}-option-${activeIndex}`
                    : undefined
                }
                tabIndex={-1}
                ref={menuRef}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActiveIndex((current) => Math.max(0, Math.min(current + 1, options.length - 1)));
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveIndex((current) => Math.max(current - 1, 0));
                  } else if (event.key === "Home" || event.key === "End") {
                    event.preventDefault();
                    setActiveIndex(event.key === "Home" ? 0 : Math.max(0, options.length - 1));
                  } else if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    const option = options[activeIndex];
                    if (option) choose(option.value);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setOpen(false);
                    requestAnimationFrame(() => triggerRef.current?.focus());
                  } else if (event.key === "Tab") {
                    setOpen(false);
                  }
                }}
                style={{
                  position: "fixed",
                  top: menuPosition.top,
                  left: menuPosition.left,
                  width: menuPosition.width
                }}
                className="z-[80] max-h-[min(16rem,calc(100vh-1rem))] overflow-y-auto rounded-md border border-white/10 bg-[#18181b] p-1 shadow-lg focus:outline-none"
              >
                {options.map((option, index) => {
                  const isSelected = option.value === value;
                  const highlighted = index === activeIndex;
                  return (
                    <li
                      key={option.value}
                      role="option"
                      aria-selected={isSelected}
                      id={`${optionIdPrefix}-option-${index}`}
                      data-dropdown-index={index}
                    >
                      <button
                        type="button"
                        tabIndex={-1}
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
                        <span className="flex shrink-0 items-center gap-2">
                          {option.detail ? (
                            <span className="text-[10px] text-cyan-300">{option.detail}</span>
                          ) : null}
                          {isSelected ? (
                            <CheckIcon className="size-4 text-cyan-400" />
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>,
              document.body
            )
        : null}
    </div>
  );
}
