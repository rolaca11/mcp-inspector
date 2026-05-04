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
        "mx-auto max-w-[1800px] px-8 py-12 flex flex-col gap-10",
        className,
      )}
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-4 min-w-0">
          <h1 className="text-3xl font-semibold leading-none tracking-tight text-balance">
            {title}
          </h1>
          {description && (
            <p className="text-base text-muted-foreground max-w-2xl text-balance leading-relaxed">
              {description}
            </p>
          )}
          {meta && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 pt-3 text-sm text-muted-foreground">
              {meta}
            </div>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
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
    <span className="inline-flex items-center gap-2">
      {Icon && <Icon className="size-4 text-muted-foreground/70" />}
      {children}
    </span>
  );
}
