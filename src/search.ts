export type SearchValue = string | null | undefined;

// Shared normalization keeps plain-text filtering aligned with the
// case-insensitive regex used by xterm's search addon.
export function normalizeSearchText(value: string): string {
  return value.toLowerCase();
}

function compactQuery(query: string): string {
  return normalizeSearchText(query).replace(/\s+/g, "");
}

// Returns null for no match. Higher scores represent tighter, earlier
// matches, allowing ranked surfaces such as the command palette to put the
// strongest results first while other surfaces can preserve their own order.
export function fuzzySearchScore(query: string, values: SearchValue[]): number | null {
  const needle = compactQuery(query);
  if (!needle) return 0;

  const haystack = normalizeSearchText(values.filter(Boolean).join(" "));
  const exactIndex = haystack.indexOf(normalizeSearchText(query.trim()));
  if (exactIndex >= 0) return 10_000 - exactIndex;

  let needleIndex = 0;
  let firstIndex = -1;
  let previousIndex = -2;
  let consecutive = 0;
  let boundaryHits = 0;

  for (let index = 0; index < haystack.length && needleIndex < needle.length; index += 1) {
    if (haystack[index] !== needle[needleIndex]) continue;
    if (firstIndex < 0) firstIndex = index;
    if (index === previousIndex + 1) consecutive += 1;
    if (index === 0 || /[\s._/\\-]/.test(haystack[index - 1])) boundaryHits += 1;
    previousIndex = index;
    needleIndex += 1;
  }

  if (needleIndex !== needle.length) return null;
  const span = previousIndex - firstIndex + 1;
  return 1_000 + consecutive * 12 + boundaryHits * 20 - span - firstIndex;
}

export function fuzzySearchMatches(query: string, values: SearchValue[]): boolean {
  return fuzzySearchScore(query, values) !== null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// xterm's search addon accepts a regex source rather than a predicate. This
// equivalent ordered-character pattern keeps terminal find aligned with the
// shared matcher and never crosses a terminal line.
export function fuzzySearchPattern(query: string): string {
  return Array.from(query.trim().replace(/\s+/g, ""))
    .map(escapeRegExp)
    .join("[^\\r\\n]*?");
}
