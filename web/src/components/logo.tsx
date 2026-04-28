import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  size?: number;
}

export function Logo({ className, size = 22 }: LogoProps) {
  return (
    <div
      className={cn(
        "relative grid place-items-center rounded-md bg-foreground text-background font-mono font-black tracking-tight",
        className,
      )}
      style={{
        width: size + 8,
        height: size + 8,
        boxShadow:
          "0 0 0 1px oklch(1 0 0 / 0.06) inset, 0 0 24px oklch(0.78 0.16 158 / 0.25)",
      }}
      aria-label="MCP Inspector"
    >
      <span style={{ fontSize: size - 6 }}>{"M"}</span>
      <span
        aria-hidden
        className="absolute -right-1 -top-1 size-2 rounded-full bg-success"
      />
    </div>
  );
}
