import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A bare content section: an optional header (title · description · right-aligned
 * action) followed by its body, with no surrounding card chrome (border,
 * background, padding). Used where content should read directly on the page
 * rather than being boxed.
 */
export function Section({
  title,
  titleClassName,
  description,
  descriptionClassName,
  action,
  className,
  children,
  onKeyDown,
}: {
  title?: React.ReactNode;
  titleClassName?: string;
  description?: React.ReactNode;
  descriptionClassName?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
  onKeyDown?: React.KeyboardEventHandler<HTMLElement>;
}) {
  const hasHeader = title || description || action;
  return (
    <section className={cn("space-y-4", className)} onKeyDown={onKeyDown}>
      {hasHeader && (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            {title && (
              <h2 className={cn("font-semibold leading-none", titleClassName)}>
                {title}
              </h2>
            )}
            {description && (
              <div
                className={cn(
                  "text-sm text-muted-foreground",
                  descriptionClassName,
                )}
              >
                {description}
              </div>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
