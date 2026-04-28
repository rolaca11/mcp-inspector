import * as React from "react";
import { CircleDashed } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmptyProps {
  icon?: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  description?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export function Empty({
  icon: Icon = CircleDashed,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: EmptyProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/60 bg-card/30 px-6 py-12 text-center",
        className,
      )}
    >
      <span className="grid place-items-center size-10 rounded-full bg-muted/40 text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <div className="space-y-1">
        <div className="font-medium">{title}</div>
        {description && (
          <p className="max-w-md text-sm text-muted-foreground text-balance">
            {description}
          </p>
        )}
      </div>
      {actionLabel && onAction && (
        <Button variant="secondary" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
