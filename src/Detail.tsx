import type { ReactNode } from "react";

type Props = {
  label: string;
  className?: string;
  children: ReactNode;
};

export function Detail({ label, className, children }: Props) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium leading-5 tracking-normal text-zinc-400">{label}</dt>
      <dd className="mt-1 min-w-0 [overflow-wrap:anywhere] text-zinc-300">{children}</dd>
    </div>
  );
}
