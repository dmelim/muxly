import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { EmojiPicker } from "frimousse";
import type { ServiceConfig } from "./types";
import { Button } from "./Button";
import { Tooltip } from "./Tooltip";
import { BUILTIN_SERVICE_ICONS, BuiltinServiceIcon } from "./serviceIcons";

export type ServiceFormDraft = {
  id: string;
  name: string;
  iconType: "none" | "emoji" | "builtin" | "image";
  iconValue: string;
  program: string;
  argsText: string; // one arg per line
  cwd: string;
  envText: string; // KEY=value per line
  port: string; // string for input control
  group: string;
  autoRestart: boolean;
};

type Props = {
  initial: ServiceConfig | null; // null = new service
  existingIds: string[]; // for id-uniqueness validation (excluding the one being edited)
  onSave: (service: ServiceConfig) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>; // omit for new services
};

export function ServiceForm({ initial, existingIds, onSave, onCancel, onDelete }: Props) {
  const [draft, setDraft] = useState<ServiceFormDraft>(() => toDraft(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validationError = useMemo(() => validate(draft, existingIds), [draft, existingIds]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave(fromDraft(draft));
    } catch (caught) {
      setError(String(caught));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!onDelete) return;
    if (!confirm(`Delete service "${draft.name || draft.id}"?`)) return;

    setSaving(true);
    setError(null);
    try {
      await onDelete();
    } catch (caught) {
      setError(String(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <h2 className="text-sm font-semibold">{initial ? "Edit service" : "New service"}</h2>
        <Button variant="link" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 text-sm">
        <Field label="ID" hint="Unique short identifier, e.g. web-api">
          <input
            value={draft.id}
            onChange={(e) => setDraft({ ...draft, id: e.target.value })}
            disabled={initial !== null}
            className="form-input"
            placeholder="web-api"
          />
        </Field>

        <Field label="Name">
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="form-input"
            placeholder="Web API"
          />
        </Field>

        <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
          <Field label="Icon">
            <SelectField
              value={draft.iconType}
              options={[
                { value: "none", label: "None" },
                { value: "emoji", label: "Emoji" },
                { value: "builtin", label: "Built-in" },
                { value: "image", label: "Image" }
              ]}
              onChange={(value) =>
                setDraft({
                  ...draft,
                  iconType: value as ServiceFormDraft["iconType"],
                  iconValue: ""
                })
              }
            />
          </Field>
          <Field
            label={iconValueLabel(draft.iconType)}
            hint={iconValueHint(draft.iconType)}
            className={draft.iconType === "emoji" ? "max-w-24" : undefined}
          >
            {draft.iconType === "builtin" ? (
              <BuiltinIconGrid
                value={draft.iconValue}
                onChange={(value) => setDraft({ ...draft, iconValue: value })}
              />
            ) : draft.iconType === "emoji" ? (
              <EmojiSelector
                value={draft.iconValue}
                onChange={(value) => setDraft({ ...draft, iconValue: value })}
              />
            ) : (
              <input
                value={draft.iconValue}
                onChange={(e) => setDraft({ ...draft, iconValue: e.target.value })}
                disabled={draft.iconType === "none"}
                className="form-input"
                placeholder={iconValuePlaceholder(draft.iconType)}
              />
            )}
          </Field>
        </div>

        <Field label="Program" hint="The executable, e.g. npm, node, python">
          <input
            value={draft.program}
            onChange={(e) => setDraft({ ...draft, program: e.target.value })}
            className="form-input"
            placeholder="npm"
          />
        </Field>

        <Field label="Arguments" hint="One per line">
          <textarea
            value={draft.argsText}
            onChange={(e) => setDraft({ ...draft, argsText: e.target.value })}
            rows={3}
            className="form-input font-mono text-xs"
            placeholder={"run\ndev"}
          />
        </Field>

        <Field label="Working dir" hint="Absolute or relative to services.json">
          <input
            value={draft.cwd}
            onChange={(e) => setDraft({ ...draft, cwd: e.target.value })}
            className="form-input font-mono text-xs"
            placeholder="."
          />
        </Field>

        <Field label="Environment" hint="KEY=value per line">
          <textarea
            value={draft.envText}
            onChange={(e) => setDraft({ ...draft, envText: e.target.value })}
            rows={3}
            className="form-input font-mono text-xs"
            placeholder={"NODE_ENV=development\nPORT=3000"}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Port" hint="Optional, for browser open">
            <input
              value={draft.port}
              onChange={(e) => setDraft({ ...draft, port: e.target.value })}
              type="number"
              inputMode="numeric"
              className="form-input"
              placeholder="3000"
            />
          </Field>

          <Field label="Group" hint="Optional sidebar grouping">
            <input
              value={draft.group}
              onChange={(e) => setDraft({ ...draft, group: e.target.value })}
              className="form-input"
              placeholder="frontend"
            />
          </Field>
        </div>

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={draft.autoRestart}
            onChange={(e) => setDraft({ ...draft, autoRestart: e.target.checked })}
            className="mt-0.5"
          />
          <span>
            <span className="block text-xs font-medium uppercase tracking-wider text-zinc-400">
              Auto-restart on crash
            </span>
            <span className="block text-[11px] text-zinc-500">
              Re-spawn automatically if the process exits with an error (max 3 tries per minute)
            </span>
          </span>
        </label>

        {error || validationError ? (
          <p className="rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {error ?? validationError}
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-white/10 px-5 py-4">
        {onDelete ? (
          <Button variant="destructive" size="sm" onClick={handleDelete} disabled={saving}>
            Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={saving || validationError !== null}
          >
            {saving
              ? initial
                ? "Saving…"
                : "Adding…"
              : initial
              ? "Save changes"
              : "Add service"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
  className = ""
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`block space-y-1 ${className}`}>
      <span className="block text-xs font-medium uppercase tracking-wider text-zinc-400">{label}</span>
      {children}
      {hint ? <span className="block text-[11px] text-zinc-500">{hint}</span> : null}
    </div>
  );
}

type SelectOption = {
  value: string;
  label: string;
  icon?: ReactNode;
};

const EMOJI_CATEGORY_SHORTCUTS = [
  { key: "smileys-emotion", label: "Smileys & Emotion", icon: "😀" },
  { key: "people-body", label: "People & Body", icon: "👋" },
  { key: "animals-nature", label: "Animals & Nature", icon: "🌿" },
  { key: "food-drink", label: "Food & Drink", icon: "🍔" },
  { key: "travel-places", label: "Travel & Places", icon: "🚗" },
  { key: "activities", label: "Activities", icon: "⚽" },
  { key: "objects", label: "Objects", icon: "💡" },
  { key: "symbols", label: "Symbols", icon: "❤️" },
  { key: "flags", label: "Flags", icon: "🚩" }
] as const;

const EMOJI_POPOVER_WIDTH = 288;
const POPOVER_EDGE_GAP = 8;
const POPOVER_TRIGGER_GAP = 6;

function SelectField({
  value,
  options,
  onChange
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];

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
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-white/10 bg-black/25 px-2.5 py-2 text-left text-[0.8125rem] text-zinc-200 transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected?.icon ? (
            <span className="shrink-0 text-zinc-400">{selected.icon}</span>
          ) : null}
          <span className="truncate">{selected?.label ?? ""}</span>
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
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-md border border-white/10 bg-zinc-900 py-1 shadow-lg"
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition ${
                  active
                    ? "bg-white/[0.03] text-zinc-100"
                    : "text-zinc-300 hover:bg-white/5 hover:text-zinc-100"
                }`}
              >
                {option.icon ? (
                  <span className="shrink-0 text-zinc-400">{option.icon}</span>
                ) : null}
                <span className="truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function EmojiSelector({
  value,
  onChange
}: {
  value: string;
  onChange: (value: string) => void;
}) {
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
      if (
        target &&
        (triggerRef.current?.contains(target) || popoverRef.current?.contains(target))
      ) {
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

    const header = root.querySelector<HTMLElement>(
      `[data-emoji-category-key="${categoryKey}"]`
    );
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
                <div
                  className="mb-2 flex gap-1 overflow-x-auto border-b border-white/10 pb-2"
                  aria-label="Emoji categories"
                >
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
                      const previewEmoji = (emoji?.emoji ?? value.trim()) || "😀";
                      const previewLabel =
                        emoji?.label ?? (value.trim() ? "Selected emoji" : "Choose emoji");

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

function BuiltinIconGrid({
  value,
  onChange
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = BUILTIN_SERVICE_ICONS.find((icon) => icon.value === value);
  const normalizedQuery = query.trim().toLowerCase();
  const options = normalizedQuery
    ? BUILTIN_SERVICE_ICONS.filter(
        (icon) =>
          icon.label.toLowerCase().includes(normalizedQuery) ||
          icon.value.includes(normalizedQuery)
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
          {options.length === 0 ? (
            <p className="text-[11px] text-zinc-500">No icons found.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function toDraft(service: ServiceConfig | null): ServiceFormDraft {
  if (!service) {
    return {
      id: "",
      name: "",
      program: "",
      argsText: "",
      cwd: ".",
      envText: "",
      port: "",
      group: "",
      autoRestart: false,
      iconType: "none",
      iconValue: ""
    };
  }
  const iconDraft = iconToDraft(service.icon);
  return {
    id: service.id,
    name: service.name,
    iconType: iconDraft.iconType,
    iconValue: iconDraft.iconValue,
    program: service.program,
    argsText: service.args.join("\n"),
    cwd: service.cwd,
    envText: Object.entries(service.env)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
    port: service.port != null ? String(service.port) : "",
    group: service.group ?? "",
    autoRestart: service.autoRestart
  };
}

function fromDraft(draft: ServiceFormDraft): ServiceConfig {
  const args = draft.argsText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const env: Record<string, string> = {};
  for (const rawLine of draft.envText.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue; // skip malformed lines silently — validate() flagged them
    env[line.slice(0, eq).trim()] = line.slice(eq + 1);
  }

  const portValue = draft.port.trim();
  const port = portValue ? Number(portValue) : null;

  const groupValue = draft.group.trim();
  const iconValue = draft.iconValue.trim();

  return {
    id: draft.id.trim(),
    name: draft.name.trim(),
    icon:
      draft.iconType === "none" || !iconValue
        ? null
        : draft.iconType === "image"
        ? { type: "image", path: iconValue }
        : { type: draft.iconType, value: iconValue },
    program: draft.program.trim(),
    args,
    cwd: draft.cwd.trim() || ".",
    env,
    port: Number.isFinite(port) ? port : null,
    group: groupValue || null,
    autoRestart: draft.autoRestart
  };
}

function validate(draft: ServiceFormDraft, existingIds: string[]): string | null {
  const id = draft.id.trim();
  if (!id) return "ID is required";
  if (existingIds.includes(id)) return `ID "${id}" is already used by another service`;
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) return "ID may only contain letters, numbers, dot, dash, underscore";

  if (!draft.name.trim()) return "Name is required";
  if (!draft.program.trim()) return "Program is required";
  if (!draft.cwd.trim()) return "Working dir is required";
  if (draft.iconType !== "none" && !draft.iconValue.trim()) {
    return "Icon value is required";
  }
  if (draft.iconType === "emoji" && Array.from(draft.iconValue.trim()).length > 4) {
    return "Emoji icon should be one short emoji or symbol";
  }

  if (draft.port.trim()) {
    const port = Number(draft.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return "Port must be an integer between 1 and 65535";
    }
  }

  for (const rawLine of draft.envText.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) return `Env line "${line}" must be KEY=value`;
  }

  return null;
}

function iconToDraft(icon: ServiceConfig["icon"]): Pick<ServiceFormDraft, "iconType" | "iconValue"> {
  if (!icon) return { iconType: "none", iconValue: "" };
  if (icon.type === "image") return { iconType: "image", iconValue: icon.path };
  return { iconType: icon.type, iconValue: icon.value };
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
  if (type === "emoji") return "⚙";
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
