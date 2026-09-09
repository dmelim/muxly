import type { ServiceConfig } from "./types";
import { displayServiceName } from "./types";
import { LogSearchCache, type ServiceHits } from "./logSearchCache";
import { isServiceOutputHidden } from "./streamPrivacy";

/** Privacy gate before the text cache: concealed logs are never indexed. */
export class StreamLogSearchCache {
  private cache = new LogSearchCache();
  private visible = new Set<string>();

  retain(serviceIds: Set<string>) {
    for (const id of this.visible) if (!serviceIds.has(id)) this.visible.delete(id);
    this.cache.retain(this.visible);
  }

  search(service: ServiceConfig, chunks: string[], revision: number, query: string,
    alias: string, streamMode: boolean): ServiceHits {
    if (isServiceOutputHidden(service, streamMode)) {
      this.visible.delete(service.id);
      this.cache.retain(this.visible);
      return { serviceId: service.id, serviceName: displayServiceName(service, true), hits: [], total: 0 };
    }
    this.visible.add(service.id);
    return this.cache.search(service, chunks, revision, query, alias, streamMode);
  }
}
