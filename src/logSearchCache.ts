import type { ServiceConfig } from "./types";
import { displayServiceName, redactSensitive } from "./types";
import { fuzzySearchMatches } from "./search";

export type ServiceHits = {
  serviceId: string;
  serviceName: string;
  hits: Array<{ lineNumber: number; line: string }>;
  total: number;
};

type Entry = {
  revision: number;
  privacyKey: string;
  lines: string[];
  query: string | null;
  result: ServiceHits | null;
};

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const MAX_HITS_PER_SERVICE = 25;

// One prepared buffer and one result per service. Query edits reuse prepared
// lines; unchanged output reuses the complete result, including zero matches.
export class LogSearchCache {
  private entries = new Map<string, Entry>();

  retain(serviceIds: Set<string>) {
    for (const id of this.entries.keys()) {
      if (!serviceIds.has(id)) this.entries.delete(id);
    }
  }

  search(service: ServiceConfig, chunks: string[], revision: number, query: string,
    alias: string, streamMode: boolean): ServiceHits {
    const privacyKey = JSON.stringify([streamMode, service.sensitive, service.cwd,
      service.name, service.group, alias]);
    let entry = this.entries.get(service.id);
    if (!entry || entry.revision !== revision || entry.privacyKey !== privacyKey) {
      const displayLog = redactSensitive(chunks.join(""), service, alias, streamMode);
      entry = { revision, privacyKey, lines: displayLog.replace(ANSI, "").split(/\r?\n/),
        query: null, result: null };
      this.entries.set(service.id, entry);
    }
    if (entry.query === query && entry.result) return entry.result;

    const result: ServiceHits = { serviceId: service.id,
      serviceName: displayServiceName(service, streamMode), hits: [], total: 0 };
    for (let index = 0; index < entry.lines.length; index += 1) {
      const line = entry.lines[index];
      if (!fuzzySearchMatches(query, [line])) continue;
      result.total += 1;
      if (result.hits.length < MAX_HITS_PER_SERVICE) {
        result.hits.push({ lineNumber: index + 1, line });
      }
    }
    entry.query = query;
    entry.result = result;
    return result;
  }
}
