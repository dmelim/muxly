import type { ServiceConfig } from "./types";

export type EditTarget =
  | { mode: "edit"; service: ServiceConfig }
  | { mode: "new" }
  | { mode: "import" };
