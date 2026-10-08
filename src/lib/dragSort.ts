/**
 * Touch-and-mouse reordering. The browser's drag-and-drop does not start on a touch screen, so a
 * grip is dragged with pointer events: the item under the finger when it lifts is where the
 * dragged one lands. Items carry `data-sort-group` and `data-sort-id`; the grip carries the handlers.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";

/**
 * `ids` with `id` moved to where `targetId` is, and the index herdr is told: null when nothing moves.
 * herdr counts the index before the item leaves its place and inserts ahead of the item there,
 * so a move forward names the slot after the target.
 */
export function moveIds(ids: readonly string[], id: string, targetId: string): { order: string[]; index: number } | null {
  const from = ids.indexOf(id);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return null;
  const order = [...ids];
  order.splice(from, 1);
  order.splice(to, 0, id);
  return { order, index: from < to ? to + 1 : to };
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
  const targetAt = (event: PointerEvent<HTMLElement>): string | null => {
    const item = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(`[data-sort-group="${CSS.escape(group)}"]`);
    return item?.dataset["sortId"] ?? null;
  };
  const end = (): void => { over.current = null; setDraggingId(null); setOverId(null); };
  const grip: DragSort["grip"] = (id) => ({
    onPointerDown: (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      setDraggingId(id);
    },
    onPointerMove: (event) => {
      if (draggingId !== id) return;
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
