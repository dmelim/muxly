import type { InputHTMLAttributes } from "react";
import { CheckIcon } from "./icons";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export function Checkbox({ className = "", ...props }: Props) {
  return (
    <span className={`relative inline-flex size-4 shrink-0 align-middle ${className}`}>
      <input
        {...props}
        type="checkbox"
        className="peer m-0 size-4 cursor-pointer appearance-none rounded border border-zinc-500/60 bg-black/25 transition-colors checked:border-cyan-400 checked:bg-cyan-400 hover:border-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#15181d] disabled:cursor-not-allowed disabled:opacity-40"
      />
      <span className="pointer-events-none absolute inset-0 hidden items-center justify-center text-cyan-950 peer-checked:flex peer-disabled:opacity-40">
        <CheckIcon className="size-3" />
      </span>
    </span>
  );
}
