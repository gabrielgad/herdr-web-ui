import { describe, expect, it } from "bun:test";
import { enterSends } from "./enterKey.ts";

const key = (modifiers: Partial<{ shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }> = {}) => ({ shiftKey: false, metaKey: false, ctrlKey: false, ...modifiers });

describe("Enter in a text box", () => {
  it("sends on a keyboard when the setting says so, and breaks the line with Shift", () => {
    expect(enterSends(key(), true, false)).toBe(true);
    expect(enterSends(key({ shiftKey: true }), true, false)).toBe(false);
  });
  it("needs Ctrl or Cmd when the setting is off", () => {
    expect(enterSends(key(), false, false)).toBe(false);
    expect(enterSends(key({ ctrlKey: true }), false, false)).toBe(true);
    expect(enterSends(key({ metaKey: true }), false, false)).toBe(true);
    expect(enterSends(key({ ctrlKey: true, shiftKey: true }), false, false)).toBe(false);
  });
  it("never sends on a bare Enter on a touch screen", () => {
    expect(enterSends(key(), true, true)).toBe(false);
    expect(enterSends(key(), false, true)).toBe(false);
    expect(enterSends(key({ metaKey: true }), true, true)).toBe(true);
  });
  it("keeps Ctrl+Enter sending on a touch screen with a hardware keyboard, and Shift+Enter a line", () => {
    expect(enterSends(key({ ctrlKey: true }), true, true)).toBe(true);
    expect(enterSends(key({ ctrlKey: true }), false, true)).toBe(true);
    expect(enterSends(key({ shiftKey: true }), true, true)).toBe(false);
    expect(enterSends(key({ shiftKey: true, ctrlKey: true }), true, true)).toBe(false);
  });
});
