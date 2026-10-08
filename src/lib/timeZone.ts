/**
 * The zone times are shown in: the device's own, except when the device sits at UTC+0 (a browser
 * that hides its zone reports UTC, or a stand-in such as Atlantic/Reykjavik) and the PC the app
 * runs on does not, so every time would show hours off.
 */
let pcZone: string | null = null;

export function setServerTimeZone(zone: string | null | undefined): void {
  pcZone = zone ?? null;
}

const hourIn = (zone: string, at: Date): string => at.toLocaleString("en-US", { timeZone: zone, hour12: false, hour: "2-digit", day: "2-digit" });

/** For `timeZone:` of an Intl format; undefined leaves the device's zone. */
export function displayTimeZone(deviceOffsetMinutes: number = new Date().getTimezoneOffset(), at: Date = new Date()): string | undefined {
  if (deviceOffsetMinutes !== 0 || pcZone === null) return undefined;
  try { return hourIn(pcZone, at) === hourIn("UTC", at) ? undefined : pcZone; } catch { return undefined; }
}
