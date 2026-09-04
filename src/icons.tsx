// Small inline SVG icon set (lucide-style, 24×24 viewBox). Hand-written rather
// than pulling in an icon library — only a handful are needed.

type IconProps = { className?: string };

const STROKE = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const
};

/** Filled play triangle — Start. */
export function PlayIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

/** Filled rounded square — Stop. */
export function StopIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  );
}

/** Two columns of dots — a drag handle. */
export function GripVerticalIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <circle cx="9" cy="6" r="1.4" />
      <circle cx="9" cy="12" r="1.4" />
      <circle cx="9" cy="18" r="1.4" />
      <circle cx="15" cy="6" r="1.4" />
      <circle cx="15" cy="12" r="1.4" />
      <circle cx="15" cy="18" r="1.4" />
    </svg>
  );
}

/** Counter-clockwise arrow — Restart. */
export function RestartIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} className={className} aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

/** Paired clockwise arrows - refresh current data. */
export function RefreshIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} className={className} aria-hidden="true">
      <path d="M21 12a9 9 0 0 1-15.2 6.2L3 15" />
      <path d="M3 21v-6h6" />
      <path d="M3 12A9 9 0 0 1 18.2 5.8L21 9" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

/** Brush sweeping away — Clear log. */
export function ClearIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} className={className} aria-hidden="true">
      <path d="m16 22-1-4" />
      <path d="M19 14a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2h-3a1 1 0 0 1-1-1V4a2 2 0 0 0-4 0v5a1 1 0 0 1-1 1H6a2 2 0 0 0-2 2v1a1 1 0 0 0 1 1" />
      <path d="M19 14H5l-1.973 6.767A1 1 0 0 0 4 22h16a1 1 0 0 0 .973-1.233z" />
      <path d="m8 22 1-4" />
    </svg>
  );
}

/** Magnifying glass — Search. */
export function SearchIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

/** Floppy disk - save settings. */
export function SaveIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} className={className} aria-hidden="true">
      <path d="M5 3h12l3 3v15H4V4a1 1 0 0 1 1-1Z" />
      <path d="M8 3v6h8V3" />
      <path d="M8 21v-7h8v7" />
    </svg>
  );
}

/** Push pin - keep a service at the top of its group. */
export function PinIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} className={className} aria-hidden="true">
      <path d="M12 17v5" />
      <path d="m5 17 2-6V5h10v6l2 6z" />
      <path d="M5 5h14" />
    </svg>
  );
}

/** Eye — privacy visible/off toggle. */
export function EyeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} className={className} aria-hidden="true">
      <path d="M2.1 12S5.6 5 12 5s9.9 7 9.9 7-3.5 7-9.9 7-9.9-7-9.9-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Eye off — privacy hidden/on toggle. */
export function EyeOffIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} className={className} aria-hidden="true">
      <path d="M10.7 5.1A10.8 10.8 0 0 1 12 5c6.4 0 9.9 7 9.9 7a18.3 18.3 0 0 1-2.3 3.3" />
      <path d="M6.6 6.6A18 18 0 0 0 2.1 12S5.6 19 12 19a10.9 10.9 0 0 0 5.4-1.4" />
      <path d="m2 2 20 20" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

/** Two columns — open in split view. */
export function SplitIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} className={className} aria-hidden="true">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M12 3v18" />
    </svg>
  );
}

/** Panel with a left rail — toggle the left sidebar. */
export function PanelLeftIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} className={className} aria-hidden="true">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

/** Panel with a right rail — toggle the right sidebar. */
export function PanelRightIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} className={className} aria-hidden="true">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M15 3v18" />
    </svg>
  );
}

/** Plus — new / add. */
export function PlusIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} className={className} aria-hidden="true">
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

/** Chevron right — collapsed/expanded disclosure. */
export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} className={className} aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} className={className} aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** Check mark — selected option in a dropdown. */
export function CheckIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} className={className} aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** Terminal prompt glyph — toggle the bottom shell drawer. */
export function TerminalIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} className={className} aria-hidden="true">
      <path d="m4 17 6-6-6-6" />
      <path d="M12 19h8" />
    </svg>
  );
}

/** Gear — open the Settings view. */
export function SettingsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} className={className} aria-hidden="true">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** ⌘ — open the command palette. */
export function CommandIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} className={className} aria-hidden="true">
      <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
    </svg>
  );
}

/** X — close. */
export function CloseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} className={className} aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

/** Trash can — destructive delete action. */
export function DeleteIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} className={className} aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="m19 6-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

/** Warning triangle — missing runtime requirements. */
export function AlertTriangleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} className={className} aria-hidden="true">
      <path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}
