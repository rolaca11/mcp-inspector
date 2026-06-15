import * as React from "react";

import { cn } from "@/lib/utils";

interface PageShellProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * Per-page container. Restructured from a centered, marketing-style column into
 * a dense app panel: full content width, compact padding, a demoted title row
 * (page-level actions like search sit top-right). The shell chrome (sidebar /
 * rail, toolbar, status bar) provides the surrounding app frame.
 */
export function PageShell({
  title,
  description,
  meta,
  actions,
  children,
  className,
}: PageShellProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-6 px-4 py-4 sm:px-6 sm:py-5",
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <h1 className="text-lg font-semibold leading-tight tracking-tight text-balance">
            {title}
          </h1>
          {description && (
            <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground text-balance">
              {description}
            </p>
          )}
          {meta && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-0.5 text-sm text-muted-foreground">
              {meta}
            </div>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

export function MetaItem({
  icon: Icon,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5">
      {Icon && <Icon className="size-4 text-muted-foreground/70" />}
      {children}
    </span>
  );
}
