import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EmojiPicker } from "frimousse";
import { Dropdown } from "./Dropdown";
import { Field } from "./FormField";
import type { ServiceFormDraft } from "./serviceFormModel";
import { BUILTIN_SERVICE_ICONS, BuiltinServiceIcon } from "./serviceIcons";
import { Tooltip } from "./Tooltip";

type Props = {
  iconType: ServiceFormDraft["iconType"];
  iconValue: string;
  onIconTypeChange: (value: ServiceFormDraft["iconType"]) => void;
  onIconValueChange: (value: string) => void;
};

export function ServiceIconInput({
  iconType,
  iconValue,
  onIconTypeChange,
  onIconValueChange
}: Props) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
      <Field label="Icon">
        <Dropdown
          ariaLabel="Icon type"
          value={iconType}
          options={[
            { value: "none", label: "None" },
            { value: "emoji", label: "Emoji" },
            { value: "builtin", label: "Built-in" },
            { value: "image", label: "Image" }
          ]}
          onChange={(value) => onIconTypeChange(value as ServiceFormDraft["iconType"])}
        />
      </Field>
      <Field
        label={iconValueLabel(iconType)}
        hint={iconValueHint(iconType)}
        className={iconType === "emoji" ? "max-w-24" : undefined}
      >
        {iconType === "builtin" ? (
          <BuiltinIconGrid value={iconValue} onChange={onIconValueChange} />
        ) : iconType === "emoji" ? (
          <EmojiSelector value={iconValue} onChange={onIconValueChange} />
        ) : (
          <input
            value={iconValue}
            onChange={(e) => onIconValueChange(e.target.value)}
            disabled={iconType === "none"}
            className="form-input"
            placeholder={iconValuePlaceholder(iconType)}
          />
        )}
      </Field>
    </div>
  );
}

const EMOJI_CATEGORY_SHORTCUTS = [
  { key: "smileys-emotion", label: "Smileys & Emotion", icon: "\u{1F600}" },
  { key: "people-body", label: "People & Body", icon: "\u{1F44B}" },
  { key: "animals-nature", label: "Animals & Nature", icon: "\u{1F33F}" },
  { key: "food-drink", label: "Food & Drink", icon: "\u{1F354}" },
  { key: "travel-places", label: "Travel & Places", icon: "\u{1F697}" },
  { key: "activities", label: "Activities", icon: "\u26BD" },
  { key: "objects", label: "Objects", icon: "\u{1F4A1}" },
  { key: "symbols", label: "Symbols", icon: "\u2764\uFE0F" },
  { key: "flags", label: "Flags", icon: "\u{1F6A9}" }
] as const;

const EMOJI_POPOVER_WIDTH = 288;
const POPOVER_EDGE_GAP = 8;
const POPOVER_TRIGGER_GAP = 6;

function EmojiSelector({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const pickerRootRef = useRef<HTMLDivElement | null>(null);
  const pickerViewportRef = useRef<HTMLDivElement | null>(null);

  const placePopover = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const centeredLeft = rect.left + rect.width / 2 - EMOJI_POPOVER_WIDTH / 2;
    const left = Math.max(
      POPOVER_EDGE_GAP,
      Math.min(centeredLeft, window.innerWidth - EMOJI_POPOVER_WIDTH - POPOVER_EDGE_GAP)
    );

    setPopoverPos({
      top: rect.bottom + POPOVER_TRIGGER_GAP,
      left
    });
  }, []);

  useLayoutEffect(() => {
    if (open) placePopover();
  }, [open, placePopover]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && (triggerRef.current?.contains(target) || popoverRef.current?.contains(target))) {
        return;
      }
      setOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", placePopover);
    window.addEventListener("scroll", placePopover, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", placePopover);
      window.removeEventListener("scroll", placePopover, true);
    };
  }, [open, placePopover]);

  function scrollToCategory(categoryKey: string) {
    const root = pickerRootRef.current;
    const viewport = pickerViewportRef.current;
    if (!root || !viewport) return;

    const header = root.querySelector<HTMLElement>(`[data-emoji-category-key="${categoryKey}"]`);
    const target = header?.closest<HTMLElement>("[frimousse-category]") ?? header;
    if (!target) return;

    viewport.scrollTo({
      top: Math.max(0, target.offsetTop - 4),
      behavior: "smooth"
    });
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-white/10 bg-black/25 px-2.5 py-2 text-left text-[0.8125rem] text-zinc-200 transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
      >
        <span className="flex min-w-0 items-center gap-2">
          {value.trim() ? (
            <span className="flex size-5 shrink-0 items-center justify-center text-sm">
              {value.trim()}
            </span>
          ) : (
            <span className="truncate text-zinc-500">Choose emoji</span>
          )}
        </span>
        <span className={`text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="size-3.5"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      {open
        ? createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              aria-label="Choose emoji icon"
              style={{
                top: popoverPos.top,
                left: popoverPos.left,
                width: EMOJI_POPOVER_WIDTH
              }}
              className="fixed z-50 max-w-[calc(100vw-1rem)] overflow-hidden rounded-md border border-white/10 bg-zinc-900 p-2 shadow-lg"
            >
              <EmojiPicker.Root
                ref={pickerRootRef}
                columns={7}
                emojibaseUrl="https://cdn.jsdelivr.net/npm/emojibase-data@17.0.0"
                onEmojiSelect={(emoji) => {
                  onChange(emoji.emoji);
                  setOpen(false);
                }}
                className="flex h-[22rem] min-h-0 flex-col"
              >
                <div className="mb-2 flex items-center gap-2">
                  <EmojiPicker.Search
                    autoFocus
                    className="form-input"
                    placeholder="Search emoji"
                    aria-label="Search emoji"
                  />
                  <EmojiPicker.SkinToneSelector
                    className="flex size-9 shrink-0 items-center justify-center rounded-md border border-white/10 bg-black/25 text-base transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
                    aria-label="Change emoji skin tone"
                  />
                </div>
                <div className="mb-2 flex gap-1 overflow-x-auto border-b border-white/10 pb-2" aria-label="Emoji categories">
                  {EMOJI_CATEGORY_SHORTCUTS.map((category) => (
                    <Tooltip key={category.key} label={category.label} side="top">
                      <button
                        type="button"
                        onClick={() => scrollToCategory(category.key)}
                        className="flex size-8 shrink-0 items-center justify-center rounded-md text-base text-zinc-300 transition hover:bg-white/5 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
                        aria-label={`Show ${category.label} emoji`}
                      >
                        {category.icon}
                      </button>
                    </Tooltip>
                  ))}
                </div>
                <EmojiPicker.Viewport
                  ref={pickerViewportRef}
                  className="min-h-0 flex-1 overflow-y-auto rounded-md border border-white/10 bg-black/20 p-1"
                >
                  <EmojiPicker.Loading className="flex h-full items-center justify-center text-xs text-zinc-500">
                    Loading...
                  </EmojiPicker.Loading>
                  <EmojiPicker.Empty className="flex h-full items-center justify-center text-xs text-zinc-500">
                    No emoji found.
                  </EmojiPicker.Empty>
                  <EmojiPicker.List
                    className="space-y-1"
                    components={{
                      CategoryHeader: ({ category, ...props }) => (
                        <div
                          {...props}
                          data-emoji-category-key={emojiCategoryKey(category.label)}
                          className="sticky top-0 z-10 bg-[#18181b] px-1.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500"
                        >
                          {category.label}
                        </div>
                      ),
                      Row: ({ children, ...props }) => (
                        <div {...props} className="flex scroll-mt-7 gap-1 px-0.5">
                          {children}
                        </div>
                      ),
                      Emoji: ({ emoji, ...props }) => (
                        <button
                          {...props}
                          type="button"
                          className={`flex aspect-square size-8 items-center justify-center rounded-md text-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 ${
                            emoji.isActive ? "bg-white/[0.07]" : "hover:bg-white/5"
                          }`}
                        >
                          {emoji.emoji}
                        </button>
                      )
                    }}
                  />
                </EmojiPicker.Viewport>
                <div className="mt-2 flex min-h-9 items-center gap-2 border-t border-white/10 pt-2">
                  <EmojiPicker.ActiveEmoji>
                    {({ emoji }) => {
                      const previewEmoji = (emoji?.emoji ?? value.trim()) || "\u{1F600}";
                      const previewLabel = emoji?.label ?? (value.trim() ? "Selected emoji" : "Choose emoji");

                      return (
                        <>
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-white/5 text-lg">
                            {previewEmoji}
                          </span>
                          <span className="min-w-0 truncate text-xs text-zinc-400">
                            {previewLabel}
                          </span>
                        </>
                      );
                    }}
                  </EmojiPicker.ActiveEmoji>
                </div>
              </EmojiPicker.Root>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function BuiltinIconGrid({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = BUILTIN_SERVICE_ICONS.find((icon) => icon.value === value);
  const normalizedQuery = query.trim().toLowerCase();
  const options = normalizedQuery
    ? BUILTIN_SERVICE_ICONS.filter(
        (icon) => icon.label.toLowerCase().includes(normalizedQuery) || icon.value.includes(normalizedQuery)
      )
    : BUILTIN_SERVICE_ICONS;

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-white/10 bg-black/25 px-2.5 py-2 text-left text-[0.8125rem] text-zinc-200 transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected ? (
            <span className="shrink-0 text-zinc-400">
              <BuiltinServiceIcon name={selected.value} className="size-4" />
            </span>
          ) : (
            <span className="shrink-0 text-zinc-500">
              <BuiltinServiceIcon name="terminal" className="size-4 opacity-40" />
            </span>
          )}
          <span className="truncate">{selected?.label ?? "Choose..."}</span>
        </span>
        <span className={`text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="size-3.5"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Choose built-in icon"
          className="absolute right-0 top-full z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] space-y-2 rounded-md border border-white/10 bg-zinc-900 p-2 shadow-lg"
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="form-input"
            placeholder="Search icons"
            aria-label="Search built-in icons"
          />
          <div className="grid max-h-56 grid-cols-[repeat(auto-fill,minmax(2rem,1fr))] gap-1.5 overflow-y-auto pr-1">
            {options.map((icon) => {
              const active = icon.value === value;
              return (
                <Tooltip key={icon.value} label={icon.label} side="top" className="w-full">
                  <button
                    type="button"
                    onClick={() => {
                      onChange(icon.value);
                      setOpen(false);
                    }}
                    aria-label={`Use ${icon.label} icon`}
                    aria-pressed={active}
                    className={`flex aspect-square w-full items-center justify-center rounded-md border transition ${
                      active
                        ? "border-white/15 bg-white/[0.03] text-zinc-100"
                        : "border-white/10 bg-black/20 text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
                    }`}
                  >
                    <BuiltinServiceIcon name={icon.value} className="size-4" />
                  </button>
                </Tooltip>
              );
            })}
          </div>
          {options.length === 0 ? <p className="text-[11px] text-zinc-500">No icons found.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function iconValueLabel(type: ServiceFormDraft["iconType"]) {
  if (type === "none") return "Value";
  if (type === "image") return "Image path";
  return "Value";
}

function iconValueHint(type: ServiceFormDraft["iconType"]) {
  if (type === "image") return "Absolute path, or relative to the service working dir";
  if (type === "builtin") return "Search and choose a small visual marker";
  if (type === "emoji") return "One short emoji or symbol";
  return "Optional";
}

function iconValuePlaceholder(type: ServiceFormDraft["iconType"]) {
  if (type === "emoji") return "\u2699";
  if (type === "image") return ".muxly/icon.png";
  return "";
}

function emojiCategoryKey(label: string) {
  return label
    .toLowerCase()
    .replace(/&/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
