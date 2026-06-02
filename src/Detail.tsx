import type { ReactNode } from "react";

type Props = {
  label: string;
  children: ReactNode;
};

export function Detail({ label, children }: Props) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">{label}</dt>
      <dd className="mt-1 text-zinc-300">{children}</dd>
    </div>
  );
}
