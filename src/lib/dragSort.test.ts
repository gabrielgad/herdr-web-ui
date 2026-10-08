import { describe, expect, it } from "bun:test";

import { moveIds, orderBy, sameIds } from "./dragSort.ts";

describe("moveIds", () => {
  it("moves an item to where the target is, forwards and backwards", () => {
    expect(moveIds(["a", "b", "c"], "a", "c")).toEqual({ order: ["b", "c", "a"], index: 3 });
    expect(moveIds(["a", "b", "c"], "c", "a")).toEqual({ order: ["c", "a", "b"], index: 0 });
    expect(moveIds(["a", "b", "c"], "b", "c")).toEqual({ order: ["a", "c", "b"], index: 3 });
  });
  it("tells herdr the slot before the item there: the target's own for a move back, the next one for a move forward", () => {
    expect(moveIds(["a", "b", "c", "d"], "b", "a")?.index).toBe(0);
    expect(moveIds(["a", "b", "c", "d"], "a", "b")?.index).toBe(2);
    expect(moveIds(["a", "b", "c", "d"], "a", "d")?.index).toBe(4);
  });
  it("is nothing when the drop is on itself or on a stranger", () => {
    expect(moveIds(["a", "b"], "a", "a")).toBeNull();
    expect(moveIds(["a", "b"], "a", "z")).toBeNull();
    expect(moveIds(["a", "b"], "z", "a")).toBeNull();
  });
  it("leaves the list it was given as it was", () => {
    const ids = ["a", "b", "c"];
    moveIds(ids, "a", "c");
    expect(ids).toEqual(["a", "b", "c"]);
  });
});

describe("orderBy", () => {
  it("follows the given ids and keeps unnamed items after them", () => {
    expect(orderBy(["a", "b", "c"], (x) => x, ["c", "a"])).toEqual(["c", "a", "b"]);
    expect(orderBy(["a", "b"], (x) => x, null)).toEqual(["a", "b"]);
    expect(orderBy(["a", "b"], (x) => x, undefined)).toEqual(["a", "b"]);
  });
  it("keeps unnamed items in their own order and ignores ids that are gone", () => {
    expect(orderBy(["a", "b", "c", "d"], (x) => x, ["z", "c"])).toEqual(["c", "a", "b", "d"]);
  });
  it("orders objects by the id they carry", () => {
    expect(orderBy([{ id: "a" }, { id: "b" }], (x) => x.id, ["b", "a"])).toEqual([{ id: "b" }, { id: "a" }]);
  });
});

describe("sameIds", () => {
  it("compares order as well as members", () => {
    expect(sameIds(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameIds(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameIds(["a"], ["a", "b"])).toBe(false);
  });
});
