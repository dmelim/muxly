// Word-boundary patterns that suggest a long-running dev server or watcher
// which needs a TTY. Kept roughly in sync with the muxly-register-service skill
// so the app and the skill nudge consistently.
const DEV_SERVER_PATTERNS: RegExp[] = [
  /\bdev\b/,
  /\bwatch\b/,
  /\bserve\b/,
  /\bstart\b/,
  /\bvite\b/,
  /\bwxt\b/,
  /\bnext\b/,
  /\bnuxt\b/,
  /\bastro\b/,
  /\bsvelte-?kit\b/,
  /\bremix\b/,
  /\bsolid-?start\b/,
  /\bqwik\b/,
  /\banalog\b/,
  /\bnodemon\b/,
  /\bvitest\b/,
  /\bwrangler\b/,
  /\bexpo\b/,
  /\bstorybook\b/,
  /\bwebpack-dev-server\b/,
  /\breact-native\b/
];

/**
 * True when the program + args look like a dev server / watch command that
 * benefits from PTY mode. This powers a dismissible suggestion in ServiceForm.
 */
export function looksLikeDevServer(program: string, argsText: string): boolean {
  const haystack = `${program} ${argsText}`.toLowerCase();
  return DEV_SERVER_PATTERNS.some((pattern) => pattern.test(haystack));
}
