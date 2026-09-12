import type { ServiceConfig } from "./types";
import { LogSearchCache, type ServiceHits } from "./logSearchCache";

/** Search only the display-time representation while Stream mode is active. */
export class StreamLogSearchCache {
  private cache = new LogSearchCache();
  private redactor: ((text: string) => string) | null = null;

  retain(serviceIds: Set<string>) {
    this.cache.retain(serviceIds);
  }

  search(service: ServiceConfig, chunks: string[], revision: number, query: string,
    alias: string, streamMode: boolean, redactStreamOutput: (text: string) => string): ServiceHits {
    if (this.redactor !== redactStreamOutput) {
      this.cache = new LogSearchCache();
      this.redactor = redactStreamOutput;
    }
    return this.cache.search(service, chunks, revision, query, alias, streamMode, redactStreamOutput);
  }
}
