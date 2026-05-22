import type { ButtonHTMLAttributes } from "react";

/**
 * Shared button, shadcn-style. One component, one set of shapes/sizes, so the
 * whole app stays visually consistent.
 *
 * Variants:
 *  - primary      cyan solid — the main action (Start)
 *  - secondary    subtle filled — neutral actions (Stop, Clear)
 *  - ghost        transparent until hover — low-emphasis actions (Edit)
 *  - destructive  rose tint — deletes
 *  - warning      amber solid — attention actions (Restart)
 *  - link         text-only, underline on hover — Cancel / dismiss
 *  - dashed       dashed outline — additive actions (New service, Import)
 */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "destructive"
  | "warning"
  | "link"
  | "dashed";

export type ButtonSize = "xs" | "sm" | "md" | "icon";

const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md " +
  "font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-cyan-400/40 disabled:cursor-not-allowed disabled:opacity-50";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-cyan-500 text-cyan-950 hover:bg-cyan-400",
  secondary: "bg-white/10 text-zinc-100 hover:bg-white/15",
  ghost: "text-zinc-300 hover:bg-white/10 hover:text-white",
  destructive: "bg-rose-500/15 text-rose-300 hover:bg-rose-500/25",
  warning: "bg-amber-500 text-amber-950 hover:bg-amber-400",
  link: "text-zinc-400 hover:text-zinc-200 underline-offset-2 hover:underline",
  dashed:
    "border border-dashed border-white/15 text-zinc-300 hover:border-white/30 hover:text-white"
};

const SIZES: Record<ButtonSize, string> = {
  xs: "px-2 py-1 text-xs",
  sm: "px-3 py-1.5 text-xs",
  md: "px-3 py-2 text-sm",
  // Square, for icon-only buttons. Pair with an explicitly-sized icon child.
  icon: "size-7"
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({
  variant = "secondary",
  size = "md",
  type = "button",
  className = "",
  ...props
}: ButtonProps) {
  // The link variant is text-only; padding would make it read as a filled button.
  const sizing = variant === "link" ? "text-xs" : SIZES[size];
  return (
    <button
      type={type}
      className={`${BASE} ${VARIANTS[variant]} ${sizing} ${className}`}
      {...props}
    />
  );
}
