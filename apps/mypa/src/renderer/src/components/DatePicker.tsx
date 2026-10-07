import { useState } from "react";

import { CalendarIcon } from "lucide-react";

import { Button } from "./ui/button";
import { Calendar } from "./ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Props {
  id?: string;
  /** "yyyy-mm-dd" */
  value: string;
  onChange: (value: string) => void;
  /** Shown when no date is set. */
  placeholder?: string;
}

/** A shadcn Popover + Calendar date field — replaces the native <input type="date">. */
export function DatePicker({ id, value, onChange, placeholder = "Pick a date" }: Props) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(`${value}T00:00:00`) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className="min-w-0 flex-1 justify-start font-normal"
        >
          <CalendarIcon className="shrink-0 opacity-60" size={15} />
          <span className="truncate">
            {selected
              ? selected.toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })
              : placeholder}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(d) => {
            if (!d) return;
            onChange(toDateInput(d));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
