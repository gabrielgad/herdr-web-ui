import { afterEach, expect, test } from "bun:test";
import { displayTimeZone, setServerTimeZone } from "./timeZone.ts";

const winter = new Date("2026-01-15T12:00:00Z");

afterEach(() => setServerTimeZone(null));

test("a device with a real offset stands", () => {
  setServerTimeZone("America/New_York");
  expect(displayTimeZone(-60, winter)).toBeUndefined();
  expect(displayTimeZone(240, winter)).toBeUndefined();
});

test("a device at UTC+0 takes the PC's zone", () => {
  setServerTimeZone("America/New_York");
  expect(displayTimeZone(0, winter)).toBe("America/New_York");
});

test("UTC+0 on both, or no PC zone, leaves the device", () => {
  setServerTimeZone("Atlantic/Reykjavik");
  expect(displayTimeZone(0, winter)).toBeUndefined();
  setServerTimeZone(null);
  expect(displayTimeZone(0, winter)).toBeUndefined();
});
