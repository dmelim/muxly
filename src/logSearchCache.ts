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

const MAX_HITS_PER_SERVICE = 25;

// Search operates on stored terminal chunks rather than xterm's parsed buffer.
// Remove complete control strings first so an ANSI colour change inserted in
// the middle of a path cannot prevent Stream mode from recognizing that path.
function stripTerminalSequences(text: string): string {
  let output = "";
  let state: "text" | "escape" | "csi" | "string" | "stringEscape" = "text";

  for (const character of text) {
    const code = character.charCodeAt(0);
    if (state === "text") {
      if (character === "\x1b") {
        state = "escape";
      } else if (character === "\x9b") {
        state = "csi";
      } else if (character === "\x9d") {
        state = "string";
      } else if (code >= 0x20 || character === "\n" || character === "\r" || character === "\t") {
        output += character;
      }
      continue;
    }

    if (state === "escape") {
      if (character === "[") state = "csi";
      else if ("]P^_X".includes(character)) state = "string";
      else state = "text";
      continue;
    }

    if (state === "csi") {
      if (code >= 0x40 && code <= 0x7e) state = "text";
      continue;
    }

    if (state === "stringEscape") {
      state = character === "\\" ? "text" : character === "\x1b" ? "stringEscape" : "string";
      continue;
    }

    if (character === "\x07") state = "text";
    else if (character === "\x1b") state = "stringEscape";
  }

  return output;
}

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
    alias: string, streamMode: boolean, redactStreamOutput?: (text: string) => string): ServiceHits {
    const privacyKey = JSON.stringify([streamMode, service.sensitive, service.cwd,
      service.name, service.group, alias]);
    let entry = this.entries.get(service.id);
    if (!entry || entry.revision !== revision || entry.privacyKey !== privacyKey) {
      const plainLog = stripTerminalSequences(chunks.join(""));
      const displayLog = streamMode
        ? (redactStreamOutput?.(plainLog) ?? redactSensitive(plainLog, service, alias, true))
        : plainLog;
      entry = { revision, privacyKey, lines: displayLog.split(/\r?\n/),
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
