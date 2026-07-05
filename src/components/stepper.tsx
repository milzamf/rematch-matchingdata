import { Check } from "lucide-react";

export type StepperItem = { id: number; title: string; desc?: string };

export function Stepper({
  steps,
  current,
  onSelect,
}: {
  steps: StepperItem[];
  current: number;
  onSelect?: (id: number) => void;
}) {
  return (
    <ol
      className="grid w-full gap-0"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
    >
      {steps.map((s, i) => {
        const done = s.id < current;
        const active = s.id === current;
        const isLast = i === steps.length - 1;
        return (
          <li key={s.id} className="relative flex flex-col items-center min-w-0 px-1">
            {/* connector */}
            {!isLast && (
              <span
                className={`absolute top-3.5 left-1/2 w-full h-px -translate-y-1/2 ${
                  done ? "bg-brand/60" : "bg-border"
                }`}
                aria-hidden
              />
            )}

            <button
              type="button"
              onClick={() => onSelect?.(s.id)}
              className="relative z-10 flex flex-col items-center gap-1.5 w-full group"
            >
              <span
                className={[
                  "size-7 rounded-full grid place-items-center text-[11px] font-semibold shrink-0 transition-colors",
                  done
                    ? "bg-brand text-brand-foreground"
                    : active
                      ? "bg-accent text-accent-foreground ring-4 ring-accent/15"
                      : "bg-secondary text-muted-foreground",
                ].join(" ")}
              >
                {done ? <Check className="size-3.5" /> : s.id}
              </span>
              <div className="hidden md:block text-center w-full px-1">
                <p
                  className={`text-[11px] font-semibold leading-tight truncate ${
                    active || done ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {s.title}
                </p>
                {s.desc && (
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5 truncate">
                    {s.desc}
                  </p>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
