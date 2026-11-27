import { useId } from "react";

// Time chips grouped by day, one to pick (D181): the opponents' offered starts
// on the match page. Native radio buttons under the chips, so the choice is
// sent with the form (`name`) and the keyboard works without JavaScript.
export type Slot = { value: string; label: string; disabled?: boolean };
export type SlotDay = { label: string; slots: readonly Slot[] };

const CHIP =
  "relative flex h-11 min-w-[76px] cursor-pointer items-center justify-center rounded-[10px] bg-surface-2 px-3 text-body font-semibold text-foreground tabular-nums transition-colors select-none hover:bg-surface-3 has-checked:bg-ball/14 has-checked:font-extrabold has-checked:text-ball has-checked:inset-ring-2 has-checked:inset-ring-ball has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring has-disabled:cursor-not-allowed has-disabled:opacity-40 has-disabled:hover:bg-surface-2";

export function SlotPicker({
  name,
  label,
  days,
  value,
  defaultValue,
  onValueChange,
  required,
}: {
  name: string;
  // For screen readers: what is picked ("Kezdés").
  label: string;
  days: readonly SlotDay[];
  // Controlled; or `defaultValue` alone.
  value?: string | null;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  required?: boolean;
}) {
  const id = useId();
  const controlled = value !== undefined;
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="sr-only">{label}</legend>
      <div className="flex flex-col gap-4">
        {days.map((day, d) => (
          <div key={day.label} role="group" aria-labelledby={`${id}-${d}`} className="flex flex-col gap-1.5">
            <span id={`${id}-${d}`} className="text-sm font-bold">
              {day.label}
            </span>
            <div className="flex flex-wrap gap-2">
              {day.slots.map((slot) => (
                <label key={slot.value} className={CHIP}>
                  <input
                    type="radio"
                    name={name}
                    value={slot.value}
                    disabled={slot.disabled}
                    required={required}
                    className="sr-only"
                    {...(controlled ? { checked: value === slot.value } : { defaultChecked: defaultValue === slot.value })}
                    onChange={() => onValueChange?.(slot.value)}
                  />
                  {slot.label}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  );
}
