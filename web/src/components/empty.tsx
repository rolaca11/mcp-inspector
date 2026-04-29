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
        "flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border/60 bg-card/30 px-8 py-14 text-center",
        className,
      )}
    >
      <span className="grid place-items-center size-12 rounded-full bg-muted/40 text-muted-foreground">
        <Icon className="size-6" />
      </span>
      <div className="space-y-1.5">
        <div className="text-base font-medium">{title}</div>
        {description && (
          <p className="max-w-md text-sm text-muted-foreground text-balance leading-relaxed">
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
