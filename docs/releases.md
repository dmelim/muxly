# Releases — building & publishing Muxly

How a new version of Muxly gets built, tagged, and published to
[GitHub Releases](https://github.com/dmelim/muxly/releases). Every release
gets a version tag, release notes pulled from `CHANGELOG.md`, and downloadable
installer binaries attached to it — that's how desktop OSS tools (Ghostty,
Zed, OrbStack, …) ship, and it's how we ship.

There are two paths: a **manual** one for Windows-only releases (the right
choice while only Windows is verified), and a **CI** one that builds for all
three platforms in parallel on GitHub's runners.

## Versioning

The version is declared in **four files that must move together** (also
documented in `agents.md`):

| File                        | Field                              |
| --------------------------- | ---------------------------------- |
| `package.json`              | `"version"`                        |
| `package-lock.json`         | root and application `"version"`   |
| `src-tauri/Cargo.toml`      | `[package] version`                |
| `src-tauri/tauri.conf.json` | `"version"`                        |

After changing `Cargo.toml`, run a Cargo command so the root package entry in
`src-tauri/Cargo.lock` is refreshed too.

Follow [Semantic Versioning](https://semver.org/):

- **MAJOR** — breaking change to the `services.json` schema or app behaviour.
  While at `0.x`, breaking changes still bump **MINOR** — the `0.` prefix signals
  "not yet stable". The first `1.0.0` is a deliberate stability commitment, made
  only when explicitly chosen, not as a reflex to a breaking change.
- **MINOR** — new feature, backwards-compatible
- **PATCH** — bug fix or internal change with no user-visible feature change

### Release cadence

Cut a **PATCH** (`0.3.N`) as soon as a fix or small cluster of fixes lands in
`[Unreleased]`; do not hold bug fixes for the next feature release. Corollary:
do not let a finished feature sit unreleased on `main` while fixes pile up
behind it — release the pending fixes as a **PATCH** before merging the next
feature.

When you bump the version, also move every `[Unreleased]` entry in
`CHANGELOG.md` into a new dated section, e.g. `## [0.2.0] - 2026-05-24`.

## Path A — Manual release (current default)

Best while only Windows is verified — you build locally and publish from the
machine you tested on.

### 1. Bump the version

Update the four files above to the new version, refresh `Cargo.lock`, and
update `CHANGELOG.md`.

### 2. Build the installers

```bash
npm run tauri build
```

Outputs land in `src-tauri/target/release/bundle/`:

```
msi/Muxly_<version>_x64_en-US.msi      ← MSI installer
nsis/Muxly_<version>_x64-setup.exe     ← NSIS installer (.exe)
```

Tauri builds both by default on Windows. The MSI is the "proper" enterprise
installer; the NSIS `.exe` is smaller and what most people will grab.

### 3. Commit and validate

```bash
git status --short
git add package.json package-lock.json src-tauri/Cargo.toml \
  src-tauri/Cargo.lock src-tauri/tauri.conf.json CHANGELOG.md
git diff --cached
git commit -m "chore(release): <version>"
```

Do not use `git commit -am`: it omits new files, and can hide an incomplete
release. Run the pre-flight checklist below against the committed release
state. Only after it passes, create and push the exact release tag:

```bash
git tag v<version>
git push origin main
git push origin v<version>
```

Pushing the exact tag avoids publishing unrelated local tags. The `v` prefix
is the convention `tauri-action` and most release tooling expects.

### 4. Create the GitHub release

With the [`gh` CLI](https://cli.github.com/), first copy only the new version's
section from `CHANGELOG.md` into a temporary release-notes file. Do not pass the
whole changelog, which would publish previous releases and `[Unreleased]`.

```bash
gh release create v<version> \
  "src-tauri/target/release/bundle/msi/Muxly_<version>_x64_en-US.msi" \
  "src-tauri/target/release/bundle/nsis/Muxly_<version>_x64-setup.exe" \
  --title "Muxly <version>" \
  --notes-file "<temporary-version-notes.md>" \
  --draft
```

Inspect the draft, its notes, tag, and both downloads before publishing it.

Or in the browser: **Releases → Draft a new release → pick the tag → drag the
two files in → paste notes from `CHANGELOG.md` → Publish**.

> Optional: the landing page's "View on GitHub" button can deep-link to
> `https://github.com/dmelim/muxly/releases/latest` so visitors land on the
> download instead of the source tree.

## Path B — Automated CI release (multi-platform)

When Muxly is verified on macOS and Linux too, switch to
[`tauri-action`](https://github.com/tauri-apps/tauri-action) — a GitHub Action
that builds on all three OSes in parallel on every `v*` tag push, and attaches
every installer to a single draft release.

No Mac or Linux machine needed — GitHub's runners build them for you.

Drop this at `.github/workflows/release.yml`:

```yaml
name: Release
on:
  push:
    tags: ['v*']

jobs:
  release:
    strategy:
      fail-fast: false
      matrix:
        platform: [windows-latest, macos-latest, ubuntu-22.04]
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - uses: dtolnay/rust-toolchain@stable
      - name: Linux deps
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
      - run: npm install
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'Muxly ${{ github.ref_name }}'
          releaseDraft: true
          releaseBody: 'See CHANGELOG.md for details.'
```

Then the flow becomes:

1. Bump versions + update `CHANGELOG.md` (same as manual).
2. Commit, tag `v<version>`, push tags.
3. Three jobs run in parallel: Windows MSI/EXE, macOS `.dmg`, Linux `.deb` +
   `.AppImage`.
4. They all attach to one draft release. Review the draft, edit notes, hit
   **Publish**.

## Per-platform installer types

What Tauri produces by default:

| Platform | Files                                                           |
| -------- | --------------------------------------------------------------- |
| Windows  | `.msi` (MSI installer), `.exe` (NSIS setup)                     |
| macOS    | `.dmg` (disk image), `.app` (app bundle)                        |
| Linux    | `.deb` (Debian/Ubuntu), `.AppImage` (portable), `.rpm` (Fedora) |

## Useful extras (worth knowing for later)

- **Auto-update.** Tauri's
  [updater plugin](https://v2.tauri.app/plugin/updater/) reads your GitHub
  Releases and pops "update available" prompts in the running app — opt in
  when you're ready.
- **Code signing — Windows.** Unsigned `.exe`/`.msi` installers trigger
  SmartScreen's loud red warning until enough people have downloaded them.
  An EV code-signing cert (~$200/yr) makes the warning go away immediately;
  without one, early users will need to click "More info → Run anyway."
- **Code signing — macOS.** Apple notarisation is its own dance: a paid
  Developer ID, `codesign`, `notarytool`, stapling. Worth doing before any
  macOS release goes wide, otherwise users see "App is damaged" on first run.
- **Linux.** No signing required for `.AppImage`/`.deb`/`.rpm`. They Just
  Work.

## Pre-flight checklist

Before pushing a release tag, confirm:

- [ ] All four version files match
- [ ] The root package version in `src-tauri/Cargo.lock` matches
- [ ] `CHANGELOG.md` has a dated section for this version, with no orphan
      `[Unreleased]` items belonging to this release
- [ ] `cargo test` passes (`cd src-tauri && cargo test`)
- [ ] `npm run build` passes (TypeScript + Vite production build)
- [ ] `npm run tauri build` produces a working installer locally
- [ ] You actually ran the installed app once and it launches
