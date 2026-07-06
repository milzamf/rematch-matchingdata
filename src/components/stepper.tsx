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
          <li key={s.id} className="relative flex min-w-0 flex-col items-center px-1">
            {/* connector */}
            {!isLast && (
              <span
                className={`absolute left-1/2 top-3.5 h-px w-full -translate-y-1/2 ${
                  done ? "bg-brand/60" : "bg-border"
                }`}
                aria-hidden
              />
            )}

            <button
              type="button"
              onClick={() => onSelect?.(s.id)}
              className="group relative z-10 flex w-full min-w-0 flex-col items-center gap-1.5"
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
              <div className="hidden w-full min-w-0 px-1 text-center md:block">
                <p
                  className={`mx-auto max-w-full text-[10px] font-semibold leading-tight lg:text-[11px] ${
                    active || done ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {s.title}
                </p>
                {s.desc && (
                  <p className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground">
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
