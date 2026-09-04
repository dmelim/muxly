# Muxly macOS Alpha Launch

This document contains the public information for the Muxly landing page and
the internal strategy for releasing the first macOS preview. It is the source
of truth until macOS and Windows move back to a unified release channel.

## Release decision

Muxly will launch its first macOS build as a public, experimental preview.
The preview is intended for developers who are comfortable testing early
software and reporting rough edges.

- Windows `v0.5.0` remains the current stable release and is not modified.
- macOS development and preview releases live on `preview/mac-alpha`.
- The first preview uses the tag `v0.5.1-mac-alpha.1`.
- The public release title is **macOS Alpha Preview 1**.
- The GitHub release must be marked as a **pre-release**, so the stable Windows
  release remains GitHub's latest stable release.
- Future previews increment the suffix, for example
  `v0.5.1-mac-alpha.2`.
- When macOS is ready, the preview branch is merged into `main` and a future
  stable release contains both Windows and macOS downloads.

Tags are immutable. Do not reuse or move a published preview tag; create the
next numbered preview instead.

## Landing-page copy

The following copy can be adapted directly for the website.

### macOS alpha announcement

> ## Muxly for macOS is now in alpha
>
> Muxly brings your local development services into one desktop command
> center: start and stop processes, follow live logs, monitor ports, and keep
> related projects together without juggling terminal windows.
> Muxly is developed by [Diethos](https://diethos.com).
>
> This is the first public macOS preview. It has been developed and tested on a
> MacBook Neo with Apple A18 Pro running macOS 26.6.1, but it has not yet been
> tested across a broad range of Macs, macOS versions, shells, version managers,
> and development environments.
>
> If you are comfortable trying early developer software, your feedback can
> help shape the Mac version.

### Compatibility

> **Requires an Apple Silicon Mac.** The preview supports the MacBook Neo with
> A18 Pro and Macs with M-series chips. Intel Macs are not supported yet.

The preview artifact targets `aarch64-apple-darwin`, the ARM64 architecture
used by Apple Silicon. A18 Pro is Apple Silicon even though it is not branded
as an M-series processor.

Do not state a minimum macOS version on the landing page until it has been
explicitly selected and tested.

### Alpha and security notice

> **Experimental and not notarized.** This preview is ad-hoc signed rather
> than signed with an Apple Developer ID. macOS will ask you to approve it in
> Privacy & Security before the first launch. The source is available for
> inspection, and every download includes a SHA-256 checksum.
>
> Expect rough edges. Do not use the alpha to supervise critical production
> workloads or processes that cannot be safely restarted.

Use **source-available**, not **open source**, in official copy. The repository
uses the PolyForm Noncommercial license, which is source-available but is not
an OSI-approved open-source license.

### First-launch instructions

> 1. Download the macOS DMG and drag Muxly into Applications.
> 2. Try to open Muxly once.
> 3. If macOS blocks it, open **System Settings → Privacy & Security**.
> 4. Find the message about Muxly, choose **Open Anyway**, and confirm **Open**.
>
> Muxly should only need this approval once for a given build. Never disable
> Gatekeeper globally.

Do not recommend `xattr`, `spctl --master-disable`, or any other command that
removes macOS security protections globally.

### Download choices

The landing page should present the platforms separately while the preview is
active:

- **Download for Windows** — stable `v0.5.0`.
- **Try the macOS alpha** — Apple Silicon, experimental, not notarized.

The macOS button should link to the exact GitHub prerelease rather than a
moving `releases/latest` URL. GitHub's latest stable URL should continue to
resolve to the Windows release.

### Feedback

> Found a Mac-specific problem? Please open a
> [GitHub issue](https://github.com/dmelim/muxly/issues) and include:
>
> - Mac model and chip
> - macOS version
> - Shell and version manager, if relevant
> - Whether the service uses PTY mode
> - The command being launched, with secrets removed
> - What happened and what you expected

## GitHub release copy

Use the following as the starting point for the prerelease notes.

> # Muxly macOS Alpha Preview 1
>
> This is the first public macOS build of Muxly, based on the `0.5` release
> line. It is an experimental preview for developers who are comfortable
> testing early software.
>
> Muxly is developed by [Diethos](https://diethos.com).
>
> ### Compatibility
>
> - Apple Silicon only: MacBook Neo with A18 Pro and M-series Macs
> - Intel Macs are not supported
> - Ad-hoc signed and not notarized
> - Manual installation and updates
>
> ### What is new on Mac
>
> - Finder and Dock launches recover the user's shell PATH
> - Homebrew and common Node/Python version-manager locations are discovered
> - Services run through the user's Unix shell when a pre-run step is required
> - PTY behavior is native to macOS rather than using Windows ConPTY workarounds
> - Stopping a service or quitting Muxly cleans up its Unix process group
> - Unix termination signals are shown with readable diagnostics
>
> ### Before installing
>
> This build is not notarized. macOS will require approval through
> **System Settings → Privacy & Security → Open Anyway** on first launch. Do
> not disable Gatekeeper globally.
>
> Please report issues at <https://github.com/dmelim/muxly/issues>.
> Windows users should continue using `v0.5.0`.

## Release assets

Attach only macOS files to the macOS prerelease. Suggested names:

```text
Muxly_0.5.1-mac-alpha.1_macos_aarch64.dmg
SHA256SUMS.txt
```

`SHA256SUMS.txt` should contain the checksum of the exact uploaded DMG. The
release notes should show the checksum as plain text as well.

Do not upload a new macOS binary to the existing `v0.5.0` release. That tag
points to the Windows-stable source before the macOS changes and must remain
reproducible.

## Release checklist

### Prepare

- [ ] Confirm the branch is `preview/mac-alpha` and the working tree is clean.
- [ ] Merge or cherry-pick any required fixes made to `main` since branching.
- [ ] Set `0.5.1-mac-alpha.1` in all four version locations:
  `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, and
  `src-tauri/tauri.conf.json`.
- [ ] Add the preview notes to `CHANGELOG.md`.
- [ ] Configure Tauri ad-hoc signing for the preview using signing identity
  `-`. This does not require paid Apple Developer membership.
- [ ] Confirm the app metadata names **Diethos** as the publisher and links to
  <https://muxly.diethos.com>. The ad-hoc cryptographic identity remains `-`
  because it does not authenticate a legal entity.

### Validate

- [ ] Run `npm run build`.
- [ ] Run `cargo test --locked` from `src-tauri/`.
- [ ] Run `git diff --check`.
- [ ] Build a fresh release DMG with
  `npm run tauri build -- --bundles dmg --ci`; do not reuse the existing
  `0.5.0` artifact. CI mode avoids Finder automation during DMG layout.
- [ ] Select and test the oldest supported macOS version on Apple Silicon.
  Once verified, configure the same minimum in Tauri and state it in the
  landing-page compatibility copy. Do not infer a minimum from a successful
  build on a newer Mac.
- [ ] Install from the DMG into Applications and launch it from Finder.
- [ ] Test a Homebrew-installed command and the version manager used locally.
- [ ] Test one pipe-mode and one PTY-mode service.
- [ ] Stop and restart a nested dev server; confirm its port is released.
- [ ] Quit with Command-Q; confirm no supervised process survives.
- [ ] Reopen Muxly and verify configuration, history, and window state.
- [ ] Test Open in Editor and Open in Browser.
- [ ] Verify the final app bundle's ad-hoc signature.
- [ ] Generate and independently verify the DMG SHA-256 checksum.
- [ ] Ideally download the uploaded asset on a clean macOS user account and
  verify the quarantined first-launch experience before announcing it.

### Publish

- [ ] Commit the version and release-note changes.
- [ ] Create the immutable tag `v0.5.1-mac-alpha.1` on the verified commit.
- [ ] Push `preview/mac-alpha` and the tag.
- [ ] Create **macOS Alpha Preview 1** in the existing GitHub Releases section.
- [ ] Mark it as a pre-release.
- [ ] Attach the DMG and `SHA256SUMS.txt`.
- [ ] Confirm `v0.5.0` still appears as the latest stable release.
- [ ] Update the landing page with the exact prerelease URL.
- [ ] Announce the preview and monitor GitHub issues for installation failures,
  process leaks, PATH/version-manager problems, and PTY behavior.

## Short launch post

> Muxly is coming to macOS.
>
> Diethos has released the first experimental Mac preview of its
> source-available desktop command center for local development services. It
> is working on our MacBook Neo, and we are looking for developers willing to
> test it across more
> Apple Silicon Macs and development setups.
>
> Apple Silicon only for now. Ad-hoc signed, not notarized, and definitely an
> alpha—expect rough edges.
>
> Download and details: [macOS prerelease link]

## Future unified release

The split release channel is temporary. Once the macOS preview has enough
real-world coverage:

1. Merge `preview/mac-alpha` into `main`.
2. Select the next normal stable version according to the project versioning
   policy.
3. Publish one GitHub release with clearly named Windows and macOS assets.
4. Resume unified version numbers across platforms.

Developer ID signing and notarization can be added later without changing this
branch or versioning strategy. One paid Apple Developer membership can sign
multiple maintained applications; it is not charged per Muxly release.
