import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RefObject } from "react";

export type ContextMenuItem = {
  id: string;
  label?: string;
  action?: () => void;
  disabled?: boolean;
  reason?: string;
  checked?: boolean;
  danger?: boolean;
  separator?: boolean;
  children?: ContextMenuItem[];
};

type Props = {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  restoreFocusRef?: RefObject<HTMLElement | null>;
};

const enabled = (items: ContextMenuItem[]) =>
  items.map((item, index) => (!item.separator && !item.disabled ? index : -1)).filter((i) => i >= 0);

function MenuLevel({ items, x, y, onClose, root, dismissAll, flipX, returnFocus }: Props & { root: boolean; dismissAll?: () => void; flipX?: number; returnFocus?: HTMLElement | null }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const [active, setActive] = useState(() => enabled(items)[0] ?? -1);
  const [submenu, setSubmenu] = useState<{ index: number; x: number; y: number } | null>(null);
  const submenuTriggerRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setPosition({
      left: Math.max(6, x + rect.width > window.innerWidth - 6 && flipX != null ? flipX - rect.width : Math.min(x, window.innerWidth - rect.width - 6)),
      top: Math.max(6, Math.min(y, window.innerHeight - rect.height - 6))
    });
  }, [flipX, items, root, x, y]);

  useEffect(() => { if (root) menuRef.current?.focus(); }, [root]);

  useEffect(() => { setActive(enabled(items)[0] ?? -1); setSubmenu(null); }, [items]);

  useEffect(() => {
    if (active < 0 || submenu) return;
    const item = menuRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    item?.focus({ preventScroll: true });
    item?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const openSubmenu = (index: number, element: HTMLElement) => {
    if (items[index]?.disabled || !items[index]?.children?.length) return setSubmenu(null);
    submenuTriggerRef.current = element;
    const rect = element.getBoundingClientRect();
    setSubmenu({ index, x: rect.right - 2, y: rect.top });
  };

  const run = (item: ContextMenuItem, index: number, element: HTMLElement) => {
    if (item.disabled || item.separator) return;
    if (item.children?.length) return openSubmenu(index, element);
    item.action?.();
    (dismissAll ?? onClose)();
  };

  return (
    <>
      <div
        ref={menuRef}
        role="menu"
        tabIndex={-1}
        className="fixed z-[100] max-h-[calc(100vh-12px)] min-w-52 max-w-[calc(100vw-12px)] overflow-y-auto rounded-md border border-white/10 bg-zinc-900 p-1 text-sm text-zinc-200 shadow-lg focus:outline-none"
        style={position}
        onKeyDown={(event) => {
          event.stopPropagation();
          const choices = enabled(items);
          const cursor = choices.indexOf(active);
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setSubmenu(null);
            const delta = event.key === "ArrowDown" ? 1 : -1;
            setActive(choices[(cursor + delta + choices.length) % choices.length] ?? -1);
          } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault(); setSubmenu(null); setActive(event.key === "Home" ? choices[0] : choices.at(-1) ?? -1);
          } else if ((event.key === "Enter" || event.key === " ") && active >= 0) {
            event.preventDefault();
            const el = menuRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
            if (el) run(items[active], active, el);
          } else if (event.key === "ArrowRight" && active >= 0) {
            event.preventDefault();
            const el = menuRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
            if (el) openSubmenu(active, el);
          } else if (event.key === "ArrowLeft" && !root) {
            event.preventDefault(); onClose(); returnFocus?.focus({ preventScroll: true });
          } else if (event.key === "Escape") { event.preventDefault(); (dismissAll ?? onClose)(); }
          else if (event.key === "Tab") { (dismissAll ?? onClose)(); }
        }}
      >
        {items.map((item, index) => item.separator ? (
          <div key={item.id} role="separator" className="my-1 h-px bg-white/10" />
        ) : (
          <button
            key={item.id}
            type="button"
            role={item.checked !== undefined ? "menuitemcheckbox" : "menuitem"}
            aria-checked={item.checked !== undefined ? item.checked : undefined}
            data-index={index}
            aria-disabled={item.disabled || undefined}
            aria-haspopup={item.children?.length ? "menu" : undefined}
            aria-expanded={submenu?.index === index || undefined}
            onPointerEnter={(event) => { setActive(index); openSubmenu(index, event.currentTarget); }}
            onClick={(event) => run(item, index, event.currentTarget)}
            disabled={item.disabled}
            tabIndex={index === active ? 0 : -1}
            className={`flex w-full max-w-[calc(100vw-24px)] items-center gap-2 rounded px-2.5 py-1.5 text-left outline-none transition hover:bg-white/10 focus:bg-white/10 disabled:opacity-40 ${index === active ? "bg-white/10" : ""} ${item.danger ? "text-rose-300" : ""}`}
          >
            <span className="w-3 text-center text-cyan-400">{item.checked ? "✓" : ""}</span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.disabled && item.reason ? <span className="max-w-36 truncate text-[10px] text-zinc-500">{item.reason}</span> : null}
            {item.children?.length ? <span aria-hidden="true">›</span> : null}
          </button>
        ))}
      </div>
      {submenu ? (
        <MenuLevel
          key={items[submenu.index].id}
          x={submenu.x}
          y={submenu.y}
          items={items[submenu.index].children ?? []}
          onClose={() => setSubmenu(null)}
          dismissAll={dismissAll ?? onClose}
          root={false}
          flipX={position.left}
          returnFocus={submenuTriggerRef.current}
        />
      ) : null}
    </>
  );
}

export function ContextMenu({ x, y, items, onClose, restoreFocusRef }: Props) {
  const suppressRestoreRef = useRef(false);
  const wrappedItems = useMemo(() => items.map((item) => ({
    ...item,
    action: item.action ? () => { suppressRestoreRef.current = true; item.action?.(); } : undefined,
    children: item.children?.map((child) => ({
      ...child,
      action: child.action ? () => { suppressRestoreRef.current = true; child.action?.(); } : undefined
    }))
  })), [items]);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const closeOthers = () => { suppressRestoreRef.current = true; closeRef.current(); };
    window.dispatchEvent(new CustomEvent("muxly-context-menu-open"));
    window.addEventListener("muxly-context-menu-open", closeOthers);
    const close = () => closeRef.current();
    const outside = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest('[role="menu"]')) {
        suppressRestoreRef.current = true;
        close();
      }
    };
    window.addEventListener("pointerdown", outside, true);
    const scroll = (event: Event) => { if (!(event.target as Element | null)?.closest?.('[role="menu"]')) close(); };
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("muxly-context-menu-open", closeOthers);
      if (!suppressRestoreRef.current) restoreFocusRef?.current?.focus();
    };
  }, [restoreFocusRef]);
  return createPortal(<MenuLevel x={x} y={y} items={wrappedItems} onClose={onClose} dismissAll={onClose} root />, document.body);
}
