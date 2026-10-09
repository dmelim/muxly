import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

type Props = { children: ReactNode; label: string };

// Shorten the actual visible thumb, then map scrolling across its full travel.
export function SidebarScrollArea({ children, label }: Props) {
  const id = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; scroll: number } | null>(null);
  const [metrics, setMetrics] = useState({ height: 0, total: 0, top: 0 });
  const measure = () => {
    const node = viewport.current;
    if (!node) return;
    const next = { height: node.clientHeight, total: node.scrollHeight, top: node.scrollTop };
    setMetrics((previous) => previous.height === next.height && previous.total === next.total && previous.top === next.top ? previous : next);
  };
  useLayoutEffect(() => {
    const observer = new ResizeObserver(measure);
    if (viewport.current) observer.observe(viewport.current);
    if (content.current) observer.observe(content.current);
    measure();
    return () => observer.disconnect();
  }, []);
  const max = Math.max(0, metrics.total - metrics.height);
  const thumb = metrics.total ? Math.min(metrics.height, Math.max(24, metrics.height * metrics.height / metrics.total * 0.7)) : 0;
  const travel = metrics.height - thumb;
  const scrollTo = (top: number) => {
    if (viewport.current) {
      viewport.current.scrollTop = Math.max(0, Math.min(max, top));
      measure();
    }
  };
  return (
    <div className="group/sidebar-scroll relative min-h-0 flex-1 pr-2.5">
      <div id={id} ref={viewport} tabIndex={0} aria-label={label}
        className="muxly-custom-sidebar-viewport h-full overflow-y-auto overflow-x-hidden focus-visible:outline focus-visible:outline-1 focus-visible:outline-cyan-400"
        onScroll={measure}>
        <div ref={content} className="flow-root min-w-0">{children}</div>
      </div>
      {max > 0 && metrics.height > 0 ? (
        <div ref={track} role="scrollbar" aria-label={`Scroll ${label}`} aria-controls={id}
          aria-orientation="vertical" aria-valuemin={0} aria-valuemax={Math.round(max)}
          aria-valuenow={Math.round(metrics.top)} tabIndex={0}
          className="absolute inset-y-0 right-0 muxly-scrollbar-track-vertical touch-none cursor-pointer opacity-0 transition-opacity group-hover/sidebar-scroll:opacity-100 group-focus-within/sidebar-scroll:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-cyan-400"
          onKeyDown={(event) => {
            const top = viewport.current?.scrollTop ?? 0;
            const steps: Record<string, number> = { ArrowUp: top - 40, ArrowDown: top + 40, Home: 0, End: max, PageUp: top - metrics.height, PageDown: top + metrics.height };
            if (event.key in steps) { event.preventDefault(); scrollTo(steps[event.key]); }
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 || !track.current) return;
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
            const offset = event.clientY - track.current.getBoundingClientRect().top;
            const start = max ? (viewport.current?.scrollTop ?? 0) / max * travel : 0;
            if (offset < start || offset > start + thumb) scrollTo((offset - thumb / 2) / Math.max(1, travel) * max);
            drag.current = { y: event.clientY, scroll: viewport.current?.scrollTop ?? 0 };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (drag.current) scrollTo(drag.current.scroll + (event.clientY - drag.current.y) / Math.max(1, travel) * max);
          }}
          onPointerUp={(event) => {
            drag.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => { drag.current = null; }}
          onLostPointerCapture={() => { drag.current = null; }}>
          <div className="muxly-scrollbar-thumb muxly-scrollbar-thumb-vertical"
            style={{ height: thumb, transform: `translateY(${max ? metrics.top / max * travel : 0}px)` }} />
        </div>
      ) : null}
    </div>
  );
}

