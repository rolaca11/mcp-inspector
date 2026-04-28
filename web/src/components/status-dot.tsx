import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "destructive" | "muted" | "info";

interface StatusDotProps {
  tone?: Tone;
  pulse?: boolean;
  className?: string;
}

const TONE: Record<Tone, string> = {
  success: "bg-success shadow-[0_0_10px_oklch(0.78_0.16_158/0.6)]",
  warning: "bg-warning shadow-[0_0_10px_oklch(0.82_0.16_80/0.5)]",
  destructive:
    "bg-destructive shadow-[0_0_10px_oklch(0.65_0.21_24/0.55)]",
  info: "bg-info shadow-[0_0_10px_oklch(0.78_0.13_240/0.5)]",
  muted: "bg-muted-foreground/60",
};

export function StatusDot({
  tone = "success",
  pulse = false,
  className,
}: StatusDotProps) {
  return (
    <span
      className={cn(
        "relative inline-block size-2 rounded-full",
        TONE[tone],
        className,
      )}
      aria-hidden
    >
      {pulse && (
        <span
          className={cn(
            "absolute inset-0 rounded-full animate-ping opacity-60",
            TONE[tone],
          )}
        />
      )}
    </span>
  );
}
