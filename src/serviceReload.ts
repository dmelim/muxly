import type { ServiceConfig, ServiceStatus } from "./types";

export function isServiceActive(status: ServiceStatus | undefined) {
  return status === "running" || status === "starting" || status === "stopping" || status === "restarting";
}

export function reconcileServices(loaded: ServiceConfig[], previous: ServiceConfig[], activeIds: Set<string>) {
  const loadedIds = new Set(loaded.map((service) => service.id));
  const retained = previous.filter((service) => activeIds.has(service.id) && !loadedIds.has(service.id));
  return { services: [...loaded, ...retained], retainedIds: new Set(retained.map((service) => service.id)) };
}
