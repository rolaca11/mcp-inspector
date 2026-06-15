import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "destructive" | "muted" | "info";

interface StatusDotProps {
  tone?: Tone;
  pulse?: boolean;
  className?: string;
}

// Colour both the fill and `currentColor` so the glow (shadow + ping) is
// derived from the same token and swaps with the active skin.
const TONE: Record<Tone, string> = {
  success: "bg-success text-success",
  warning: "bg-warning text-warning",
  destructive: "bg-destructive text-destructive",
  info: "bg-info text-info",
  muted: "bg-muted-foreground/60 text-transparent",
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
        tone !== "muted" && "shadow-[0_0_8px_currentColor]",
        className,
      )}
      aria-hidden
    >
      {pulse && (
        <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-60 motion-reduce:animate-none" />
      )}
    </span>
  );
}
