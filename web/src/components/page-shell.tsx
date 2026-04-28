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
        "mx-auto max-w-[1400px] px-6 py-10 flex flex-col gap-8",
        className,
      )}
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3 min-w-0">
          <h1 className="text-2xl font-semibold leading-none tracking-tight text-balance">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-muted-foreground max-w-2xl text-balance leading-relaxed">
              {description}
            </p>
          )}
          {meta && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2 text-xs text-muted-foreground">
              {meta}
            </div>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
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
    <span className="inline-flex items-center gap-1.5">
      {Icon && <Icon className="size-3.5 text-muted-foreground/70" />}
      {children}
    </span>
  );
}
