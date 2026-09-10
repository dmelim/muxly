import { useId, useLayoutEffect, useRef, useState, type HTMLAttributes } from "react";

type Props = HTMLAttributes<HTMLDivElement>;

// Draw the tab scrollbar ourselves so macOS overlay-scrollbar preferences
// cannot change its shape or hide it while the tab strip is hovered.
export function TabsScrollArea({ children, className = "", ...props }: Props) {
  const viewportId = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; scroll: number } | null>(null);
  const [metrics, setMetrics] = useState({ width: 0, total: 0, left: 0 });
  const measure = () => {
    const node = viewport.current;
    if (node) setMetrics({ width: node.clientWidth, total: node.scrollWidth, left: node.scrollLeft });
  };
  useLayoutEffect(() => {
    const observer = new ResizeObserver(measure);
    if (viewport.current) observer.observe(viewport.current);
    if (content.current) observer.observe(content.current);
    measure();
    return () => observer.disconnect();
  }, []);
  const max = Math.max(0, metrics.total - metrics.width);
  const thumb = metrics.total ? Math.min(metrics.width, Math.max(24, metrics.width * metrics.width / metrics.total)) : 0;
  const travel = metrics.width - thumb;
  const scrollTo = (left: number) => {
    if (viewport.current) viewport.current.scrollLeft = Math.max(0, Math.min(max, left));
  };
  return <div className="group/tabs relative min-w-0 flex-1">
    <div {...props} id={viewportId} ref={viewport} className={`muxly-tab-viewport ${className}`} onScroll={measure}>
      <div ref={content} className="flex w-max min-w-full gap-1">{children}</div>
    </div>
    {max > 0 ? <div
      ref={track}
      role="scrollbar"
      aria-label="Scroll panel tabs"
      aria-controls={viewportId}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(metrics.left)}
      tabIndex={0}
      className="absolute inset-x-0 top-full z-10 mt-px h-1.5 cursor-pointer opacity-0 transition-opacity group-hover/tabs:opacity-100 group-focus-within/tabs:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-cyan-400"
      onKeyDown={(event) => {
        const steps: Record<string, number> = { ArrowLeft: metrics.left - 60, ArrowRight: metrics.left + 60, Home: 0, End: max, PageUp: metrics.left - metrics.width, PageDown: metrics.left + metrics.width };
        if (event.key in steps) { event.preventDefault(); scrollTo(steps[event.key]); }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || !track.current) return;
        event.preventDefault();
        const offset = event.clientX - track.current.getBoundingClientRect().left;
        const start = max ? metrics.left / max * travel : 0;
        if (offset < start || offset > start + thumb) scrollTo((offset - thumb / 2) / Math.max(1, travel) * max);
        drag.current = { x: event.clientX, scroll: viewport.current?.scrollLeft ?? 0 };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current) scrollTo(drag.current.scroll + (event.clientX - drag.current.x) / Math.max(1, travel) * max);
      }}
      onPointerUp={(event) => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { drag.current = null; }}
      onLostPointerCapture={() => { drag.current = null; }}
    ><div className="absolute top-0 h-[5px] bg-cyan-400 hover:bg-cyan-300" style={{ width: thumb, transform: `translateX(${max ? metrics.left / max * travel : 0}px)` }} /></div> : null}
  </div>;
}
