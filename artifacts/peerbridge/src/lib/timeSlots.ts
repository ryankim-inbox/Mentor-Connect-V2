// Weekly time slots share one canonical string format with the backend and
// the DB seed: "<Day> <HH>:00" on a 24-hour clock, e.g. "Mon 17:00".
export const SLOT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export const SLOT_HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);

export const MAX_PREFERRED_TIMES = 30;

const dayIndex = (slot: string) => SLOT_DAYS.indexOf(slot.slice(0, 3) as (typeof SLOT_DAYS)[number]);

export function sortTimeSlots(slots: string[]): string[] {
  return [...slots].sort((a, b) => dayIndex(a) - dayIndex(b) || a.slice(4).localeCompare(b.slice(4)));
}
