import type { AppSettings } from "./types";

export const PROJECT_ALIAS_WORDS = [
  "alpha",
  "amber",
  "apex",
  "atlas",
  "aurora",
  "baker",
  "beacon",
  "binary",
  "bravo",
  "bridge",
  "cactus",
  "carbon",
  "cedar",
  "cipher",
  "cobalt",
  "comet",
  "copper",
  "coral",
  "delta",
  "denim",
  "drift",
  "echo",
  "ember",
  "fable",
  "field",
  "fjord",
  "flare",
  "forest",
  "foxtrot",
  "frost",
  "gamma",
  "garden",
  "glacier",
  "granite",
  "harbor",
  "hazel",
  "helios",
  "horizon",
  "indigo",
  "ion",
  "island",
  "jasmine",
  "jigsaw",
  "juno",
  "kernel",
  "kilo",
  "lagoon",
  "lambda",
  "lantern",
  "laser",
  "lima",
  "lotus",
  "lunar",
  "maple",
  "matrix",
  "meadow",
  "mercury",
  "meteor",
  "milan",
  "mirage",
  "monaco",
  "nebula",
  "neon",
  "nickel",
  "nova",
  "oasis",
  "omega",
  "onyx",
  "orbit",
  "oscar",
  "paper",
  "paris",
  "pearl",
  "phase",
  "pixel",
  "plasma",
  "prairie",
  "quartz",
  "quasar",
  "quill",
  "radar",
  "ripple",
  "reef",
  "river",
  "rocket",
  "romeo",
  "sable",
  "saffron",
  "sierra",
  "signal",
  "silver",
  "solace",
  "solar",
  "summit",
  "tango",
  "tempo",
  "terra",
  "thunder",
  "titan",
  "topaz",
  "ultra",
  "umbra",
  "union",
  "vector",
  "velvet",
  "vertex",
  "violet",
  "vista",
  "wander",
  "willow",
  "xenon",
  "yankee",
  "yellow",
  "zenith",
  "zephyr",
  "zulu"
];

export function createProjectAlias(existingAliases: Iterable<string>) {
  const used = new Set(existingAliases);

  for (let attempt = 0; attempt < 500; attempt += 1) {
    const alias = `${randomWord()}-${randomWord()}-${randomWord()}-${randomNumber()}`;
    if (!used.has(alias)) {
      return alias;
    }
  }

  let suffix = 1;
  while (used.has(`alpha-tango-sierra-${suffix}`)) {
    suffix += 1;
  }
  return `alpha-tango-sierra-${suffix}`;
}

export function aliasProjectName(realName: string, settings: AppSettings) {
  const existing = settings.projectNameAliases[realName];
  if (existing) {
    return existing;
  }
  return createProjectAlias(Object.values(settings.projectNameAliases));
}

function randomWord() {
  return PROJECT_ALIAS_WORDS[Math.floor(Math.random() * PROJECT_ALIAS_WORDS.length)];
}

function randomNumber() {
  return Math.floor(Math.random() * 90) + 10;
}
