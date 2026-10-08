/**
 * Touch-and-mouse reordering and press-and-hold. The browser's drag-and-drop does not start on a
 * touch screen, so a grip is dragged with pointer events: the item under the finger when it lifts
 * is where the dragged one lands. Items carry `data-sort-group` and `data-sort-id`; the grip
 * carries the handlers.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";

/**
 * The index herdr takes for an item moved from place `from` to place `to` (places in the list as it
 * stands, then as it ends up). herdr counts before the item leaves and inserts ahead of the item
 * there, so a move forward names the slot after the target.
 */
export function herdrIndex(from: number, to: number): number {
  return from < to ? to + 1 : to;
}

/** `ids` with `id` moved to where `targetId` is, and the index herdr is told: null when nothing moves. */
export function moveIds(ids: readonly string[], id: string, targetId: string): { order: string[]; index: number } | null {
  const from = ids.indexOf(id);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return null;
  const order = [...ids];
  order.splice(from, 1);
  order.splice(to, 0, id);
  return { order, index: herdrIndex(from, to) };
}

/** `items` in the order of `ids`; what `ids` does not name keeps its place after the named ones. */
export function orderBy<T>(items: readonly T[], idOf: (item: T) => string, ids: readonly string[] | null | undefined): T[] {
  if (!ids) return [...items];
  const rank = new Map(ids.map((id, index) => [id, index]));
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (rank.get(idOf(a.item)) ?? ids.length + a.index) - (rank.get(idOf(b.item)) ?? ids.length + b.index))
    .map(({ item }) => item);
}

export const sameIds = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * A reorder shown at once and confirmed by herdr: `ids` is the order on screen, the pending one
 * until herdr's snapshot carries it (or a few seconds pass, or herdr refuses and the old order returns).
 */
export function useOptimisticOrder(serverIds: readonly string[], send: (id: string, index: number) => Promise<void>, onError: (reason: unknown) => void) {
  const [pending, setPending] = useState<string[] | null>(null);
  const serverKey = serverIds.join("\u0000");
  useEffect(() => {
    if (pending && sameIds(pending, serverIds)) setPending(null);
  }, [pending, serverKey]);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setPending(null), 6000);
    return () => window.clearTimeout(timer);
  }, [pending]);
  const ids = pending ? orderBy(serverIds, (id) => id, pending) : [...serverIds];
  const move = useCallback((id: string, targetId: string): void => {
    const moved = moveIds(ids, id, targetId);
    if (!moved) return;
    setPending(moved.order);
    void send(id, moved.index).catch((reason: unknown) => { setPending(null); onError(reason); });
  }, [ids.join("\u0000"), send, onError]);
  return { ids, move };
}

/**
 * A copy of the dragged item that follows the pointer, so a finger does not hide what it moves.
 * It sits on the body (a drawer's transform would otherwise become its frame) with the item's
 * computed styles written onto it, since the stylesheet's selectors reach it only through its parents.
 */
export interface DragGhost {
  move: (clientX: number, clientY: number) => void;
  remove: () => void;
}

export function createDragGhost(item: HTMLElement, clientX: number, clientY: number): DragGhost {
  const rect = item.getBoundingClientRect();
  const ghost = item.cloneNode(true) as HTMLElement;
  const inline = (from: Element, to: Element): void => {
    const style = getComputedStyle(from);
    for (const name of Array.from(style)) (to as HTMLElement).style.setProperty(name, style.getPropertyValue(name));
    to.removeAttribute("id");
    to.removeAttribute("data-sort-id");
    to.removeAttribute("data-sort-group");
    Array.from(from.children).forEach((child, index) => { const copy = to.children[index]; if (copy) inline(child, copy); });
  };
  inline(item, ghost);
  Object.assign(ghost.style, {
    position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    margin: "0", pointerEvents: "none", zIndex: "2147483000", opacity: "0.92", transition: "none", animation: "none",
    boxShadow: "0 10px 28px rgba(0, 0, 0, 0.45)", transformOrigin: "50% 50%",
  });
  // the copied styles gave every child its own pointer-events: the point under the finger must reach the row below
  ghost.querySelectorAll<HTMLElement>("*").forEach((node) => { node.style.pointerEvents = "none"; });
  ghost.setAttribute("aria-hidden", "true");
  ghost.setAttribute("data-drag-ghost", "");
  document.body.appendChild(ghost);
  return {
    move: (x, y) => { ghost.style.transform = `translate(${x - clientX}px, ${y - clientY}px) scale(1.03)`; },
    remove: () => ghost.remove(),
  };
}

export interface DragSort {
  draggingId: string | null;
  overId: string | null;
  /** the grip's handlers for one item */
  grip: (id: string) => {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
    onClick: (event: MouseEvent<HTMLElement>) => void;
  };
}

/** Drags a grip over the items of one group; on release `onDrop(id, targetId)` says which landed on which. */
export function useDragSort(group: string, onDrop: (id: string, targetId: string) => void): DragSort {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const over = useRef<string | null>(null);
  const ghost = useRef<DragGhost | null>(null);
  useEffect(() => () => ghost.current?.remove(), []);
  const targetAt = (event: PointerEvent<HTMLElement>): string | null => {
    const item = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(`[data-sort-group="${CSS.escape(group)}"]`);
    return item?.dataset["sortId"] ?? null;
  };
  const end = (): void => { over.current = null; ghost.current?.remove(); ghost.current = null; setDraggingId(null); setOverId(null); };
  const grip: DragSort["grip"] = (id) => ({
    onPointerDown: (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      const item = event.currentTarget.closest<HTMLElement>(`[data-sort-group="${CSS.escape(group)}"]`);
      ghost.current?.remove();
      ghost.current = item ? createDragGhost(item, event.clientX, event.clientY) : null;
      setDraggingId(id);
    },
    onPointerMove: (event) => {
      if (draggingId !== id) return;
      ghost.current?.move(event.clientX, event.clientY);
      const target = targetAt(event);
      over.current = target;
      setOverId(target);
    },
    onPointerUp: (event) => {
      if (draggingId !== id) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      const target = targetAt(event) ?? over.current;
      end();
      if (target && target !== id) onDrop(id, target);
    },
    onPointerCancel: end,
    // a grip is not a button to press: the tap that ends a drag must not open the row under it
    onClick: (event) => { event.stopPropagation(); },
  });
  return { draggingId, overId, grip };
}

const HOLD_MS = 450;
const HOLD_SLOP_PX = 10;

/**
 * A finger that lifts soon after a hold can still be taken for a tap, and the browser then sends
 * the mouse events of one to whatever is under it by then: the menu the hold opened. Those events,
 * until a moment after the finger lifts, go nowhere.
 */
function swallowEmulatedMouse(): void {
  const types = ["mousedown", "mouseup", "click"] as const;
  const stop = (event: Event): void => { event.preventDefault(); event.stopImmediatePropagation(); };
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    for (const type of types) window.removeEventListener(type, stop, true);
    window.removeEventListener("pointerup", lifted, true);
    window.removeEventListener("pointercancel", lifted, true);
  };
  const lifted = (): void => { window.setTimeout(release, 200); };
  for (const type of types) window.addEventListener(type, stop, true);
  window.addEventListener("pointerup", lifted, true);
  window.addEventListener("pointercancel", lifted, true);
  window.setTimeout(release, 20_000);
}

/**
 * Press and hold on a touch screen (or a pen), and the right button of a mouse: `onHold` gets the
 * element held, for a menu to anchor to. A finger that moves is a scroll, not a hold. The click
 * that ends a hold is swallowed, so the row under the finger does not also open.
 */
export function useHold(onHold: (element: HTMLElement) => void) {
  const timer = useRef<number | undefined>(undefined);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const heldAt = useRef(0);
  const cancel = (): void => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
    origin.current = null;
  };
  useEffect(() => cancel, []);
  const fire = (element: HTMLElement, touching: boolean): void => {
    if (Date.now() - heldAt.current < 800) return;
    heldAt.current = Date.now();
    cancel();
    if (touching) swallowEmulatedMouse();
    onHold(element);
  };
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>): void => {
      if (event.pointerType === "mouse") return;
      const element = event.currentTarget;
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => fire(element, true), HOLD_MS);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>): void => {
      const start = origin.current;
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > HOLD_SLOP_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (event: MouseEvent<HTMLElement>): void => {
      event.preventDefault();
      fire(event.currentTarget, false);
    },
    onClickCapture: (event: MouseEvent<HTMLElement>): void => {
      // a click from the keyboard (detail 0) is not the lift of a finger or button
      if (event.detail > 0 && Date.now() - heldAt.current < 800) { event.preventDefault(); event.stopPropagation(); }
    },
  };
}
