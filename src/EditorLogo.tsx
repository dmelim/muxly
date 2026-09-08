import cursorLogo from "./editor-logos/cursor.svg";
import clionLogo from "./editor-logos/clion.svg";
import datagripLogo from "./editor-logos/datagrip.svg";
import emacsLogo from "./editor-logos/gnuemacs.svg";
import golandLogo from "./editor-logos/goland.svg";
import intellijLogo from "./editor-logos/intellijidea.svg";
import jetbrainsLogo from "./editor-logos/jetbrains.svg";
import neovimLogo from "./editor-logos/neovim.svg";
import notepadLogo from "./editor-logos/notepadplusplus.svg";
import phpstormLogo from "./editor-logos/phpstorm.svg";
import pycharmLogo from "./editor-logos/pycharm.svg";
import riderLogo from "./editor-logos/rider.svg";
import rubymineLogo from "./editor-logos/rubymine.svg";
import rustroverLogo from "./editor-logos/rustrover.svg";
import sublimeLogo from "./editor-logos/sublimetext.svg";
import vimLogo from "./editor-logos/vim.svg";
import vscodeLogo from "./editor-logos/vscode.svg";
import webstormLogo from "./editor-logos/webstorm.svg";
import windsurfLogo from "./editor-logos/windsurf.svg";
import zedLogo from "./editor-logos/zedindustries.svg";

/*
 * These files are vendored from upstream SVG repositories so the selector
 * shows the real product marks without a runtime network request:
 *
 * - Simple Icons (CC0-1.0): https://github.com/simple-icons/simple-icons/tree/develop/icons
 *   Brand source links are recorded in Simple Icons' metadata for each mark.
 * - VS Code (MIT, Devicon): https://github.com/devicons/devicon/blob/master/icons/vscode/vscode-original.svg
 * - RustRover (JetBrains brand asset): https://github.com/JetBrains/logos/blob/master/web/rustrover/rustrover.svg
 */

type Props = {
  command: string;
  label?: string;
  className?: string;
};

type EditorLogoAsset = {
  src: string;
  // Simple Icons assets are one-color black paths. Invert those paths on the
  // dark Muxly surface; JetBrains' square marks get a light tile instead so
  // their negative-space details remain legible.
  monochrome?: boolean;
  framed?: boolean;
};

const ASSETS = {
  cursor: { src: cursorLogo, monochrome: true },
  clion: { src: clionLogo, monochrome: true, framed: true },
  datagrip: { src: datagripLogo, monochrome: true, framed: true },
  emacs: { src: emacsLogo, monochrome: true },
  goland: { src: golandLogo, monochrome: true, framed: true },
  intellij: { src: intellijLogo, monochrome: true, framed: true },
  jetbrains: { src: jetbrainsLogo, monochrome: true, framed: true },
  neovim: { src: neovimLogo, monochrome: true },
  "notepad++": { src: notepadLogo, monochrome: true },
  phpstorm: { src: phpstormLogo, monochrome: true, framed: true },
  pycharm: { src: pycharmLogo, monochrome: true, framed: true },
  rider: { src: riderLogo, monochrome: true, framed: true },
  rubymine: { src: rubymineLogo, monochrome: true, framed: true },
  rustrover: { src: rustroverLogo },
  sublime: { src: sublimeLogo, monochrome: true },
  vim: { src: vimLogo, monochrome: true },
  vscode: { src: vscodeLogo },
  webstorm: { src: webstormLogo, monochrome: true, framed: true },
  windsurf: { src: windsurfLogo, monochrome: true },
  zed: { src: zedLogo, monochrome: true }
} satisfies Record<string, EditorLogoAsset>;

function commandBasename(command: string): string {
  const normalized = command.trim().replaceAll("\\", "/");
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
  return basename
    .replace(/\.(?:exe|cmd|bat|com|app)$/i, "")
    .toLowerCase();
}

function compactLabel(label: string | undefined): string {
  return (label ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .replace(/\s+/g, " ");
}

function pathIdentity(command: string): string {
  return command
    .toLowerCase()
    .replaceAll("\\", "/")
    .replace(/[^a-z0-9+#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isOneOf(value: string, choices: string[]): boolean {
  return choices.includes(value);
}

/**
 * Match the executable first, then explicit product path segments, then an
 * exact familiar label. This avoids treating an arbitrary directory named
 * `code` as Visual Studio Code, especially for Cursor installations.
 */
function resolveAsset(command: string, label?: string): EditorLogoAsset | null {
  const basename = commandBasename(command);
  const labelKey = compactLabel(label);
  const pathKey = pathIdentity(command);

  if (isOneOf(basename, ["code", "code-insiders"])) return ASSETS.vscode;
  if (basename === "cursor") return ASSETS.cursor;
  if (basename === "windsurf") return ASSETS.windsurf;
  if (basename === "zed") return ASSETS.zed;
  if (isOneOf(basename, ["subl", "sublime_text"])) return ASSETS.sublime;
  if (basename === "notepad++") return ASSETS["notepad++"];
  if (isOneOf(basename, ["idea", "idea64"])) return ASSETS.intellij;
  if (isOneOf(basename, ["pycharm", "pycharm64"])) return ASSETS.pycharm;
  if (isOneOf(basename, ["webstorm", "webstorm64"])) return ASSETS.webstorm;
  if (isOneOf(basename, ["rider", "rider64"])) return ASSETS.rider;
  if (isOneOf(basename, ["clion", "clion64"])) return ASSETS.clion;
  if (isOneOf(basename, ["goland", "goland64"])) return ASSETS.goland;
  if (isOneOf(basename, ["datagrip", "datagrip64"])) return ASSETS.datagrip;
  if (isOneOf(basename, ["rubymine", "rubymine64"])) return ASSETS.rubymine;
  if (isOneOf(basename, ["phpstorm", "phpstorm64"])) return ASSETS.phpstorm;
  if (isOneOf(basename, ["rustrover", "rustrover64"])) return ASSETS.rustrover;
  if (basename === "nvim" || basename === "neovim") return ASSETS.neovim;
  if (basename === "vim") return ASSETS.vim;
  if (basename === "emacs") return ASSETS.emacs;

  // Product-specific install folders are useful when a launcher was renamed,
  // but intentionally avoid broad substrings such as "code".
  if (/visual studio code insiders|microsoft vs code insiders/.test(pathKey)) return ASSETS.vscode;
  if (/visual studio code|microsoft vs code/.test(pathKey)) return ASSETS.vscode;
  if (/jetbrains.*(?:intellij idea|idea)/.test(pathKey)) return ASSETS.intellij;
  if (/jetbrains.*pycharm/.test(pathKey)) return ASSETS.pycharm;
  if (/jetbrains.*webstorm/.test(pathKey)) return ASSETS.webstorm;
  if (/jetbrains.*rider/.test(pathKey)) return ASSETS.rider;
  if (/jetbrains.*clion/.test(pathKey)) return ASSETS.clion;
  if (/jetbrains.*goland/.test(pathKey)) return ASSETS.goland;
  if (/jetbrains.*datagrip/.test(pathKey)) return ASSETS.datagrip;
  if (/jetbrains.*rubymine/.test(pathKey)) return ASSETS.rubymine;
  if (/jetbrains.*phpstorm/.test(pathKey)) return ASSETS.phpstorm;
  if (/jetbrains.*rustrover/.test(pathKey)) return ASSETS.rustrover;

  // Only exact, familiar labels identify a custom command. A descriptive
  // label such as "My Cursor" stays generic until its executable is known.
  if (labelKey === "vs code" || labelKey === "visual studio code" || labelKey === "vs code insiders") return ASSETS.vscode;
  if (labelKey === "cursor") return ASSETS.cursor;
  if (labelKey === "windsurf") return ASSETS.windsurf;
  if (labelKey === "zed" || labelKey === "zed editor") return ASSETS.zed;
  if (labelKey === "sublime" || labelKey === "sublime text") return ASSETS.sublime;
  if (labelKey === "notepad++") return ASSETS["notepad++"];
  if (labelKey === "intellij" || labelKey === "intellij idea") return ASSETS.intellij;
  if (labelKey === "pycharm") return ASSETS.pycharm;
  if (labelKey === "webstorm") return ASSETS.webstorm;
  if (labelKey === "rider") return ASSETS.rider;
  if (labelKey === "clion") return ASSETS.clion;
  if (labelKey === "goland") return ASSETS.goland;
  if (labelKey === "datagrip") return ASSETS.datagrip;
  if (labelKey === "rubymine") return ASSETS.rubymine;
  if (labelKey === "phpstorm") return ASSETS.phpstorm;
  if (labelKey === "rustrover") return ASSETS.rustrover;
  if (labelKey === "neovim") return ASSETS.neovim;
  if (labelKey === "vim") return ASSETS.vim;
  if (labelKey === "emacs" || labelKey === "gnu emacs") return ASSETS.emacs;
  if (labelKey === "jetbrains") return ASSETS.jetbrains;
  return null;
}

function GenericEditorLogo() {
  return (
    <svg className="size-full" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor" opacity=".25" />
      <rect x="6.5" y="7" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" d="M8.5 10.2h7m-7 2.8h4.5" />
    </svg>
  );
}

/**
 * Shows a local upstream mark for a known editor and an honest neutral mark
 * for an unknown custom command. The command remains the source of truth for
 * launching; this component only affects presentation.
 */
export function EditorLogo({ command, label, className = "size-4" }: Props) {
  const asset = resolveAsset(command, label);
  if (!asset) {
    return (
      <span className={`inline-flex shrink-0 text-zinc-400 ${className}`}>
        <GenericEditorLogo />
      </span>
    );
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${asset.framed ? "rounded-[3px] bg-zinc-100 p-px" : ""} ${className}`}
    >
      <img
        src={asset.src}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={`size-full object-contain ${asset.monochrome && !asset.framed ? "brightness-0 invert" : ""}`}
      />
    </span>
  );
}
