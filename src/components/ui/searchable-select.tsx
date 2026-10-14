import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export interface SearchableSelectOption {
  value: string;
  label: string;
  badge?: React.ReactNode;
  description?: string;
  disabled?: boolean;
}

export interface SearchableSelectProps {
  value?: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  searchable?: boolean;
  onSearchChange?: (value: string) => void;
  className?: string;
  "aria-label"?: string;
  "data-testid"?: string;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Pilih opsi...",
  searchPlaceholder = "Cari kolom atau opsi...",
  emptyText = "Tidak ada hasil ditemukan.",
  disabled = false,
  searchable = true,
  onSearchChange,
  className,
  "aria-label": ariaLabel,
  "data-testid": dataTestId,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement>(null);
  const commandRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [activeValue, setActiveValue] = React.useState("");

  React.useEffect(() => {
    if (searchable || !open) return;
    const command = commandRef.current;
    const active = listRef.current?.querySelector('[cmdk-item][data-selected="true"]');
    if (command && listRef.current) command.setAttribute("aria-controls", listRef.current.id);
    if (command && active?.id) command.setAttribute("aria-activedescendant", active.id);
  }, [activeValue, open, searchable]);

  React.useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.stopPropagation();
    };

    el.addEventListener("wheel", handleWheel, { passive: true });
    return () => {
      el.removeEventListener("wheel", handleWheel);
    };
  }, [open]);

  const selectedOption = React.useMemo(() => {
    return options.find((opt) => opt.value === value);
  }, [options, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          data-testid={dataTestId}
          disabled={disabled}
          className={cn(
            "flex h-9 sm:h-10 w-full items-center justify-between rounded-md border border-border bg-background px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm text-foreground shadow-xs transition-colors",
            "hover:border-foreground/30 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15",
            "disabled:cursor-not-allowed disabled:opacity-50",
            !selectedOption && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate text-left font-medium">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-1.5 sm:ml-2 size-3.5 sm:size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-[220px] p-0 shadow-lg"
        align="start"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (searchable ? inputRef.current : commandRef.current)?.focus();
        }}
        onWheel={(e) => e.stopPropagation()}
      >
        <Command
          ref={commandRef}
          className="w-full"
          shouldFilter={searchable && !onSearchChange}
          defaultValue={`${selectedOption?.label ?? ""} ${selectedOption?.description ?? ""}`.trim()}
          tabIndex={searchable ? -1 : 0}
          role={searchable ? undefined : "combobox"}
          aria-label={ariaLabel}
          aria-expanded={searchable ? undefined : true}
          aria-haspopup={searchable ? undefined : "listbox"}
          onValueChange={setActiveValue}
        >
          {searchable && (
            <CommandInput
              ref={inputRef}
              placeholder={searchPlaceholder}
              className="h-9 text-xs"
              onValueChange={onSearchChange}
            />
          )}
          <CommandList
            ref={listRef}
            className="max-h-60 overflow-y-auto p-1 overscroll-contain"
            onWheel={(e) => e.stopPropagation()}
          >
            <CommandEmpty className="py-3 text-center text-xs text-muted-foreground">
              {emptyText}
            </CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = option.value === value;
                return (
                  <CommandItem
                    key={option.value}
                    value={`${option.label} ${option.description ?? ""}`}
                    disabled={option.disabled}
                    onSelect={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-xs text-foreground transition-colors",
                      isSelected ? "bg-brand/10 font-semibold text-brand" : "hover:bg-secondary",
                      option.disabled && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 truncate">
                        <span className="truncate">{option.label}</span>
                        {option.badge}
                      </div>
                      {option.description && (
                        <p className="truncate text-[11px] text-muted-foreground">
                          {option.description}
                        </p>
                      )}
                    </div>
                    {isSelected && <Check className="ml-2 size-3.5 shrink-0 text-brand" />}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
