/**
 * What Enter does in a text box. On a touch screen the on-screen keyboard's return key breaks the
 * line, so a message can be formatted; only the send button sends. Ctrl or Cmd+Enter still sends
 * where a hardware keyboard is attached to it.
 */
export function touchScreen(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
}

export interface EnterKey { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }

/** Whether this Enter sends: per the Enter-sends setting, but never a bare Enter on a touch screen. */
export function enterSends(event: EnterKey, enterSendsSetting: boolean, touch: boolean): boolean {
  if (touch || !enterSendsSetting) return (event.metaKey || event.ctrlKey) && !event.shiftKey;
  return !event.shiftKey && !event.metaKey && !event.ctrlKey;
}
