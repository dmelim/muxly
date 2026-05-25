export type BuiltinServiceIconName =
  | "terminal"
  | "globe"
  | "server"
  | "database"
  | "worker"
  | "code"
  | "braces"
  | "package"
  | "boxes"
  | "cloud"
  | "lock"
  | "key"
  | "settings"
  | "wrench"
  | "gauge"
  | "monitor"
  | "layers"
  | "route"
  | "git-branch"
  | "zap"
  | "shield"
  | "bot"
  | "mail"
  | "file"
  | "folder"
  | "search"
  | "plug"
  | "network"
  | "workflow"
  | "command"
  | "cpu"
  | "hard-drive";

export type BuiltinServiceIconOption = {
  value: BuiltinServiceIconName;
  label: string;
};

export const BUILTIN_SERVICE_ICONS: BuiltinServiceIconOption[] = [
  { value: "terminal", label: "Terminal" },
  { value: "globe", label: "Globe" },
  { value: "server", label: "Server" },
  { value: "database", label: "Database" },
  { value: "worker", label: "Worker" },
  { value: "code", label: "Code" },
  { value: "braces", label: "Braces" },
  { value: "package", label: "Package" },
  { value: "boxes", label: "Boxes" },
  { value: "cloud", label: "Cloud" },
  { value: "lock", label: "Lock" },
  { value: "key", label: "Key" },
  { value: "settings", label: "Settings" },
  { value: "wrench", label: "Wrench" },
  { value: "gauge", label: "Gauge" },
  { value: "monitor", label: "Monitor" },
  { value: "layers", label: "Layers" },
  { value: "route", label: "Route" },
  { value: "git-branch", label: "Git branch" },
  { value: "zap", label: "Zap" },
  { value: "shield", label: "Shield" },
  { value: "bot", label: "Bot" },
  { value: "mail", label: "Mail" },
  { value: "file", label: "File" },
  { value: "folder", label: "Folder" },
  { value: "search", label: "Search" },
  { value: "plug", label: "Plug" },
  { value: "network", label: "Network" },
  { value: "workflow", label: "Workflow" },
  { value: "command", label: "Command" },
  { value: "cpu", label: "CPU" },
  { value: "hard-drive", label: "Hard drive" }
];

type IconProps = {
  name: string;
  className: string;
};

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round"
} as const;

export function BuiltinServiceIcon({ name, className }: IconProps) {
  switch (name) {
    case "globe":
    case "web":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3a14 14 0 0 1 0 18" />
          <path d="M12 3a14 14 0 0 0 0 18" />
        </svg>
      );
    case "server":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <rect x="4" y="5" width="16" height="6" rx="2" />
          <rect x="4" y="13" width="16" height="6" rx="2" />
          <path d="M8 8h.01" />
          <path d="M8 16h.01" />
        </svg>
      );
    case "database":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <ellipse cx="12" cy="5" rx="7" ry="3" />
          <path d="M5 5v14c0 1.7 3.1 3 7 3s7-1.3 7-3V5" />
          <path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
        </svg>
      );
    case "worker":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <path d="M12 2v4" />
          <path d="M12 18v4" />
          <path d="m4.93 4.93 2.83 2.83" />
          <path d="m16.24 16.24 2.83 2.83" />
          <path d="M2 12h4" />
          <path d="M18 12h4" />
          <circle cx="12" cy="12" r="4" />
        </svg>
      );
    case "code":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <path d="m16 18 6-6-6-6" />
          <path d="m8 6-6 6 6 6" />
        </svg>
      );
    case "braces":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1" />
          <path d="M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1" />
        </svg>
      );
    case "package":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <path d="m7.5 4.3 9 5.2" />
          <path d="m21 8-9 5-9-5" />
          <path d="M12 22V13" />
          <path d="M3 8v8l9 5 9-5V8l-9-5Z" />
        </svg>
      );
    case "boxes":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <path d="M2.97 12.92 8 15.8l5.03-2.88" />
          <path d="M8 21.6v-5.8" />
          <path d="m13.03 12.92 5.03 2.88 5.03-2.88" />
          <path d="M18.06 21.6v-5.8" />
          <path d="M8 9.2 13.03 6.3 18.06 9.2" />
          <path d="M13.03 12.92V6.3" />
        </svg>
      );
    case "cloud":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <path d="M17.5 19H8a6 6 0 1 1 5.3-8.8A4.5 4.5 0 1 1 17.5 19Z" />
        </svg>
      );
    case "lock":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      );
    case "key":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <circle cx="7.5" cy="15.5" r="4.5" />
          <path d="m11 12 8-8" />
          <path d="m15 8 2 2" />
          <path d="m17 6 2 2" />
        </svg>
      );
    case "settings":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7A2 2 0 1 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z" />
        </svg>
      );
    case "wrench":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <path d="M14.7 6.3a4 4 0 0 0-5 5L3 18v3h3l6.7-6.7a4 4 0 0 0 5-5l-2.4 2.4-3-3Z" />
        </svg>
      );
    case "gauge":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <path d="M12 14 16 9" />
          <path d="M3.3 16a9 9 0 1 1 17.4 0" />
          <path d="M5 20h14" />
        </svg>
      );
    case "monitor":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8" />
          <path d="M12 16v4" />
        </svg>
      );
    case "layers":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <path d="m12 2 9 5-9 5-9-5Z" />
          <path d="m3 12 9 5 9-5" />
          <path d="m3 17 9 5 9-5" />
        </svg>
      );
    case "route":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <circle cx="6" cy="19" r="3" />
          <circle cx="18" cy="5" r="3" />
          <path d="M9 19h1a8 8 0 0 0 8-8V8" />
        </svg>
      );
    case "git-branch":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="6" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
      );
    case "zap":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <path d="M13 2 3 14h8l-1 8 11-14h-8Z" />
        </svg>
      );
    case "shield":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3Z" />
        </svg>
      );
    case "bot":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <rect x="5" y="8" width="14" height="10" rx="2" />
          <path d="M12 8V4" />
          <path d="M9 13h.01" />
          <path d="M15 13h.01" />
          <path d="M9 18v2" />
          <path d="M15 18v2" />
        </svg>
      );
    case "mail":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 7 9 6 9-6" />
        </svg>
      );
    case "file":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
          <path d="M14 2v6h6" />
        </svg>
      );
    case "folder":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z" />
        </svg>
      );
    case "search":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      );
    case "plug":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <path d="M12 22v-5" />
          <path d="M9 8V2" />
          <path d="M15 8V2" />
          <path d="M6 8h12v4a6 6 0 0 1-12 0Z" />
        </svg>
      );
    case "network":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <rect x="9" y="2" width="6" height="6" rx="1" />
          <rect x="3" y="16" width="6" height="6" rx="1" />
          <rect x="15" y="16" width="6" height="6" rx="1" />
          <path d="M12 8v4" />
          <path d="M6 16v-2h12v2" />
        </svg>
      );
    case "workflow":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <rect x="3" y="3" width="6" height="6" rx="1" />
          <rect x="15" y="15" width="6" height="6" rx="1" />
          <path d="M9 6h5a4 4 0 0 1 4 4v5" />
          <path d="m15 12 3 3 3-3" />
        </svg>
      );
    case "command":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0 0-6Z" />
        </svg>
      );
    case "cpu":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <rect x="7" y="7" width="10" height="10" rx="2" />
          <path d="M9 1v3" />
          <path d="M15 1v3" />
          <path d="M9 20v3" />
          <path d="M15 20v3" />
          <path d="M20 9h3" />
          <path d="M20 15h3" />
          <path d="M1 9h3" />
          <path d="M1 15h3" />
        </svg>
      );
    case "hard-drive":
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 15h18" />
          <path d="M7 18h.01" />
          <path d="M11 18h.01" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" {...STROKE} className={className}>
          <path d="m4 7 5 5-5 5" />
          <path d="M12 19h8" />
        </svg>
      );
  }
}
