import type { ServiceConfig } from "./types";

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
  autoPort: boolean; // roll to next free port if `port` is busy, and inject it
  portEnvVar: string; // env var to receive the chosen port (blank = PORT)
  group: string;
  profile: string; // profile id, or "" for unassigned
  autoRestart: boolean;
  usePty: boolean;
  preRun: string; // shell prelude run before the command, same shell
  sensitive: boolean; // mask the name while stream mode is on
};

export function toDraft(service: ServiceConfig | null): ServiceFormDraft {
  if (!service) {
    return {
      id: "",
      name: "",
      program: "",
      argsText: "",
      cwd: ".",
      envText: "",
      port: "",
      autoPort: false,
      portEnvVar: "",
      group: "",
      profile: "",
      autoRestart: false,
      usePty: false,
      preRun: "",
      sensitive: false,
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
    autoPort: service.autoPort ?? false,
    portEnvVar: service.portEnvVar ?? "",
    group: service.group ?? "",
    profile: service.profile ?? "",
    autoRestart: service.autoRestart,
    usePty: service.usePty,
    preRun: service.preRun ?? "",
    sensitive: service.sensitive ?? false
  };
}

export function fromDraft(draft: ServiceFormDraft): ServiceConfig {
  const args = draft.argsText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const env: Record<string, string> = {};
  for (const rawLine of draft.envText.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
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
    autoPort: draft.autoPort,
    portEnvVar: draft.autoPort ? draft.portEnvVar.trim() || null : null,
    group: groupValue || null,
    profile: draft.profile.trim() || null,
    autoRestart: draft.autoRestart,
    usePty: draft.usePty,
    preRun: draft.preRun.trim() || null,
    sensitive: draft.sensitive
  };
}

export function validate(draft: ServiceFormDraft, existingIds: string[]): string | null {
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
