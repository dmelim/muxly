import type { ServiceConfig, ServiceIcon, ServiceStatus } from "./types";
import { BuiltinServiceIcon } from "./serviceIcons";

const statusDots: Record<ServiceStatus, string> = {
  stopped: "bg-zinc-600",
  starting: "bg-amber-400",
  running: "bg-cyan-400",
  stopping: "bg-orange-400",
  exited: "bg-sky-400",
  failed: "bg-rose-400"
};

export function ServiceIconBadge({
  service,
  imageSrc,
  status,
  large = false
}: {
  service: ServiceConfig;
  imageSrc?: string | null;
  status: ServiceStatus;
  large?: boolean;
}) {
  const size = large ? "size-10" : "size-7";
  const dotSize = large ? "size-2.5" : "size-2";
  return (
    <span
      className={`relative inline-flex ${size} shrink-0 items-center justify-center rounded-md border border-white/10 bg-black/25 text-zinc-300`}
      aria-hidden="true"
    >
      <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-[inherit]">
        <ServiceIconContent icon={service.icon} imageSrc={imageSrc} large={large} />
      </span>
      <span
        className={`absolute -bottom-px -right-px ${dotSize} rounded-full ring-2 ring-[#15181d] ${
          statusDots[status]
        }`}
      />
    </span>
  );
}

function ServiceIconContent({
  icon,
  imageSrc,
  large
}: {
  icon?: ServiceIcon | null;
  imageSrc?: string | null;
  large: boolean;
}) {
  if (icon?.type === "emoji") {
    return <span className={large ? "text-lg" : "text-sm"}>{icon.value}</span>;
  }
  if (icon?.type === "image" && imageSrc) {
    return <img src={imageSrc} alt="" className="h-full w-full object-cover" />;
  }
  if (icon?.type === "builtin") {
    return <BuiltinServiceIcon name={icon.value} className={large ? "size-5" : "size-4"} />;
  }
  return <BuiltinServiceIcon name="terminal" className={large ? "size-5" : "size-4"} />;
}
