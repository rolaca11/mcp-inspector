import * as React from "react";
import { Loader2, Sparkles } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Popover, PopoverContent } from "@/components/ui/popover";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { api } from "@/data/api";
import { useConnectionStore } from "@/stores/connection-store";
import { cn } from "@/lib/utils";

interface CompletableInputProps {
  serverName: string;
  refType: "prompt" | "resource";
  ref: string;
  argument: string;
  value: string;
  onChange: (value: string) => void;
  context?: Record<string, string>;
  className?: string;
  placeholder?: string;
}

export function CompletableInput({
  serverName,
  refType,
  ref: refId,
  argument,
  value,
  onChange,
  context,
  className,
  placeholder,
}: CompletableInputProps) {
  const data = useConnectionStore((s) => s.data);
  const hasCompletions = !!data?.capabilities.completions;

  const [suggestions, setSuggestions] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const reqRef = React.useRef(0);

  const fetchCompletions = React.useCallback(
    async (partial: string) => {
      if (!hasCompletions) return;
      const id = ++reqRef.current;
      setLoading(true);
      try {
        const cleanContext: Record<string, string> = {};
        if (context) {
          for (const [k, v] of Object.entries(context)) {
            if (v !== "") cleanContext[k] = v;
          }
        }
        const r = await api.complete(serverName, {
          refType,
          ref: refId,
          argument,
          ...(partial !== "" ? { value: partial } : {}),
          ...(Object.keys(cleanContext).length > 0
            ? { context: cleanContext }
            : {}),
        });
        if (id !== reqRef.current) return;
        setSuggestions(r.completion.values);
        setOpen(r.completion.values.length > 0);
        setActiveIndex(-1);
      } catch {
        if (id !== reqRef.current) return;
        setSuggestions([]);
        setOpen(false);
      } finally {
        if (id === reqRef.current) setLoading(false);
      }
    },
    [hasCompletions, serverName, refType, refId, argument, context],
  );

  const timerRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      onChange(v);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => fetchCompletions(v), 200);
    },
    [onChange, fetchCompletions],
  );

  React.useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  const selectSuggestion = React.useCallback(
    (s: string) => {
      onChange(s);
      setOpen(false);
      setSuggestions([]);
      inputRef.current?.focus();
    },
    [onChange],
  );

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (!open || suggestions.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) =>
          i <= 0 ? suggestions.length - 1 : i - 1,
        );
      } else if (e.key === "Enter" && activeIndex >= 0) {
        e.preventDefault();
        selectSuggestion(suggestions[activeIndex]!);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    },
    [open, suggestions, activeIndex, selectSuggestion],
  );

  const handleFocus = React.useCallback(() => {
    if (hasCompletions && suggestions.length === 0) {
      fetchCompletions(value);
    } else if (suggestions.length > 0) {
      setOpen(true);
    }
  }, [hasCompletions, suggestions.length, fetchCompletions, value]);

  const handleBlur = React.useCallback(() => {
    setTimeout(() => setOpen(false), 150);
  }, []);

  if (!hasCompletions) {
    return (
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn("font-mono", className)}
        placeholder={placeholder}
      />
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Anchor asChild>
        <div className="relative">
          <Input
            ref={inputRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={handleFocus}
            onBlur={handleBlur}
            className={cn("font-mono w-full", className)}
            placeholder={placeholder}
            autoComplete="off"
          />
          {loading && (
            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 animate-spin text-muted-foreground" />
          )}
        </div>
      </PopoverPrimitive.Anchor>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-1 max-h-56 overflow-y-auto"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {suggestions.map((s, i) => (
          <button
            key={s}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => selectSuggestion(s)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-mono text-left transition-colors cursor-pointer",
              i === activeIndex
                ? "bg-accent text-accent-foreground"
                : "hover:bg-accent/50",
            )}
          >
            <Sparkles className="size-3 text-info shrink-0" />
            <span className="truncate">{s}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
