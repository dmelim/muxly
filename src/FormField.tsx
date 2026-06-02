import type { ReactNode } from "react";

type Props = {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
};

export function Field({ label, hint, children, className = "" }: Props) {
  return (
    <div className={`block space-y-1 ${className}`}>
      <span className="block text-xs font-medium uppercase tracking-wider text-zinc-400">{label}</span>
      {children}
      {hint ? <span className="block text-[11px] text-zinc-500">{hint}</span> : null}
    </div>
  );
}
