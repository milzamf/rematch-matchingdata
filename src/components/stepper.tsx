import { Check, Lock } from "lucide-react";

export type StepperItem = {
  id: number;
  title: string;
  desc?: string;
  locked?: boolean;
  lockedLabel?: string;
};

export function Stepper({
  steps,
  current,
  onSelect,
}: {
  steps: StepperItem[];
  current: number;
  onSelect?: (id: number) => void;
}) {
  const currentStep = steps.find((s) => s.id === current) ?? steps[0];

  return (
    <div>
      <ol
        className="grid w-full gap-0"
        style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      >
        {steps.map((s, i) => {
          const done = s.id < current;
          const active = s.id === current;
          const isLast = i === steps.length - 1;
          const disabled = Boolean(s.locked);
          return (
            <li key={s.id} className="relative flex min-w-0 flex-col items-center px-1">
              {/* connector */}
              {!isLast && (
                <span
                  className={`absolute left-1/2 top-3 sm:top-4 h-px w-full -translate-y-1/2 ${
                    done ? "bg-brand/60" : "bg-border"
                  }`}
                  aria-hidden
                />
              )}

              <button
                type="button"
                onClick={() => {
                  if (!disabled) onSelect?.(s.id);
                }}
                disabled={disabled}
                title={disabled ? s.lockedLabel : s.title}
                aria-disabled={disabled}
                className="group relative z-10 flex w-full min-w-0 flex-col items-center gap-1 sm:gap-1.5 py-0.5 sm:py-1 disabled:cursor-not-allowed cursor-pointer"
              >
                <span
                  className={[
                    "size-6 sm:size-7 rounded-full grid place-items-center text-[10px] sm:text-[11px] font-semibold shrink-0 transition-colors",
                    disabled
                      ? "bg-secondary/60 text-muted-foreground/60"
                      : done
                      ? "bg-brand text-brand-foreground"
                      : active
                        ? "bg-accent text-accent-foreground ring-4 ring-accent/15"
                        : "bg-secondary text-muted-foreground",
                  ].join(" ")}
                >
                  {disabled ? <Lock className="size-3 sm:size-3.5" /> : done ? <Check className="size-3 sm:size-3.5" /> : s.id}
                </span>
                <div className="hidden w-full min-w-0 px-1 text-center md:block">
                  <p
                    className={`mx-auto max-w-full text-[10px] font-semibold leading-tight lg:text-[11px] ${
                      disabled
                        ? "text-muted-foreground/60"
                        : active || done
                          ? "text-foreground"
                          : "text-muted-foreground"
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

      {/* Mobile active step indicator */}
      {currentStep && (
        <div className="mt-2 pt-1.5 border-t border-border/50 text-center md:hidden">
          <div className="inline-flex items-center gap-1 text-[11px] sm:text-xs font-semibold text-foreground">
            <span className="text-[10px] sm:text-[11px] font-medium text-brand">Langkah {current} dari {steps.length}:</span>
            <span>{currentStep.title}</span>
          </div>
          {currentStep.desc && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {currentStep.desc}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
