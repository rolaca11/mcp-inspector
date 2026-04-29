import * as React from "react";
import { Check, Copy } from "lucide-react";

import { cn } from "@/lib/utils";

interface CodeBlockProps {
  children: string;
  language?: string;
  className?: string;
  /** Show the copy button. Defaults to true. */
  copyable?: boolean;
  /** Optional caption rendered above the block. */
  caption?: React.ReactNode;
}

export function CodeBlock({
  children,
  language,
  className,
  copyable = true,
  caption,
}: CodeBlockProps) {
  const [copied, setCopied] = React.useState(false);

  const onCopy = React.useCallback(() => {
    void navigator.clipboard.writeText(children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [children]);

  return (
    <div className={cn("group rounded-lg border border-border/60 bg-card/40 overflow-hidden", className)}>
      {(caption || language || copyable) && (
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-2 text-xs text-muted-foreground/80 font-mono">
          <span className="truncate">
            {caption ?? language ?? ""}
          </span>
          {copyable && (
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-muted/70 hover:text-foreground cursor-pointer"
              aria-label="Copy code"
            >
              {copied ? (
                <>
                  <Check className="size-3 text-success" />
                  <span>copied</span>
                </>
              ) : (
                <>
                  <Copy className="size-3" />
                  <span>copy</span>
                </>
              )}
            </button>
          )}
        </div>
      )}
      <pre className="overflow-x-auto p-4 text-sm leading-relaxed font-mono text-foreground/90">
        <code>{children}</code>
      </pre>
    </div>
  );
}
