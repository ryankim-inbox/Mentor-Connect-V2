import { useEffect, useRef } from "react";
import { MAX_PREFERRED_TIMES, SLOT_DAYS, SLOT_HOURS, sortTimeSlots } from "@/lib/timeSlots";

interface PreferredTimesFieldProps {
  value: string[];
  onChange: (slots: string[]) => void;
}

const WEEKDAYS = SLOT_DAYS.slice(0, 5);
const WEEKEND = SLOT_DAYS.slice(5);

const QUICK_PICKS: { label: string; slots: string[] }[] = [
  { label: "Weekday afternoons", slots: WEEKDAYS.flatMap((d) => ["15:00", "16:00", "17:00"].map((h) => `${d} ${h}`)) },
  { label: "Weekday evenings", slots: WEEKDAYS.flatMap((d) => ["18:00", "19:00", "20:00"].map((h) => `${d} ${h}`)) },
  { label: "Weekend daytime", slots: WEEKEND.flatMap((d) => ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"].map((h) => `${d} ${h}`)) },
];

export function PreferredTimesField({ value, onChange }: PreferredTimesFieldProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const afternoonRowRef = useRef<HTMLButtonElement>(null);
  const atMax = value.length >= MAX_PREFERRED_TIMES;

  // Start the grid scrolled to the afternoon hours — the most common pick —
  // while keeping 00:00–23:00 reachable by scrolling.
  useEffect(() => {
    if (scrollRef.current && afternoonRowRef.current) {
      scrollRef.current.scrollTop = afternoonRowRef.current.offsetTop - 36;
    }
  }, []);

  const toggle = (slot: string) => {
    if (value.includes(slot)) {
      onChange(value.filter((s) => s !== slot));
    } else if (!atMax) {
      onChange(sortTimeSlots([...value, slot]));
    }
  };

  const addAll = (slots: string[]) => {
    const merged = [...value];
    for (const slot of sortTimeSlots(slots)) {
      if (merged.includes(slot)) continue;
      if (merged.length >= MAX_PREFERRED_TIMES) break;
      merged.push(slot);
    }
    onChange(sortTimeSlots(merged));
  };

  const sorted = sortTimeSlots(value);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <label className="block text-sm font-medium text-foreground">
          Preferred times <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        {value.length > 0 && (
          <span className="text-xs font-semibold text-primary bg-primary/10 rounded-full px-2.5 py-0.5">
            {value.length} selected
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Select all times that usually work for you. Mentors use this to find overlap.
      </p>

      <div className="flex flex-wrap gap-2 mb-3">
        <button
          type="button"
          onClick={() => onChange([])}
          disabled={value.length === 0}
          className="px-2.5 py-1 rounded-full text-xs font-medium border border-input text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
        >
          Clear all
        </button>
        {QUICK_PICKS.map((pick) => (
          <button
            key={pick.label}
            type="button"
            onClick={() => addAll(pick.slots)}
            className="px-2.5 py-1 rounded-full text-xs font-medium border border-input text-foreground hover:bg-primary/10 hover:border-primary/40 hover:text-primary transition-colors"
          >
            {pick.label}
          </button>
        ))}
      </div>

      <div
        ref={scrollRef}
        className="relative max-h-56 overflow-auto rounded-xl border border-input bg-background"
      >
        <div className="min-w-[532px] grid grid-cols-7">
          {SLOT_DAYS.map((day) => (
            <div
              key={day}
              className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm border-b border-border px-1 py-1.5 text-center text-xs font-semibold text-foreground"
            >
              {day}
            </div>
          ))}
          {SLOT_HOURS.map((hour) =>
            SLOT_DAYS.map((day) => {
              const slot = `${day} ${hour}`;
              const selected = value.includes(slot);
              return (
                <div key={slot} className="p-0.5">
                  <button
                    type="button"
                    ref={day === "Mon" && hour === "15:00" ? afternoonRowRef : undefined}
                    onClick={() => toggle(slot)}
                    aria-pressed={selected}
                    aria-label={slot}
                    className={`w-full py-1 rounded-md text-[11px] font-medium tabular-nums transition-colors ${
                      selected
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : atMax
                          ? "text-muted-foreground/40 cursor-not-allowed"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    {hour}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground mt-2">
        {sorted.length === 0 ? (
          "No preferred times selected."
        ) : (
          <>
            <span className="font-medium text-foreground/80">Selected:</span>{" "}
            {sorted.slice(0, 8).join(", ")}
            {sorted.length > 8 && ` +${sorted.length - 8} more`}
          </>
        )}
        {atMax && <span className="text-destructive"> Maximum of {MAX_PREFERRED_TIMES} slots reached.</span>}
      </p>
    </div>
  );
}
