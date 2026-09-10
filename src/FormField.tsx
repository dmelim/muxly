import type { ReactNode } from "react";

import { FieldHelp } from "./FieldHelp";

type Props = {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
};

export function Field({ label, hint, children, className = "" }: Props) {
  return (
    <div className={`block space-y-1 ${className}`}>
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">{label}</span>
        {hint ? <FieldHelp label={label} hint={hint} /> : null}
      </div>
      {children}
    </div>
  );
}
