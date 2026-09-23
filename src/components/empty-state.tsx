import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = "",
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center px-4 py-8 sm:px-6 sm:py-12 ${className}`}
    >
      {Icon && (
        <div className="size-10 sm:size-12 rounded-full bg-secondary grid place-items-center mb-3 sm:mb-4">
          <Icon className="size-4 sm:size-5 text-muted-foreground" />
        </div>
      )}
      <p className="text-xs sm:text-sm font-semibold text-foreground">{title}</p>
      {description && (
        <p className="mt-0.5 sm:mt-1 text-[11px] sm:text-xs text-muted-foreground max-w-sm leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-3 sm:mt-4">{action}</div>}
    </div>
  );
}
