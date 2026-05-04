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

  const isJson =
    language === "application/json" ||
    language?.endsWith("+json");

  const highlighted = React.useMemo(
    () => (isJson ? highlightJson(children) : null),
    [isJson, children],
  );

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
        <code>{highlighted ?? children}</code>
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lightweight JSON syntax highlighting                                */
/* ------------------------------------------------------------------ */

/**
 * Regex-based tokeniser that splits a JSON string into typed spans.
 * Handles strings (distinguishing keys from values), numbers, booleans,
 * null, and structural punctuation. Falls back to plain text on
 * anything unexpected.
 */

// One pattern to match every meaningful JSON token.
// Order matters: strings must come before numbers so that "-1" inside
// a string isn't partially matched as a number.
const JSON_TOKEN =
  /("(?:[^"\\]|\\.)*")\s*(:)|("(?:[^"\\]|\\.)*")|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|(true|false)|(null)|([{}[\]:,])/g;

function highlightJson(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;

  // Reset the regex (it's global, so lastIndex must be 0).
  JSON_TOKEN.lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = JSON_TOKEN.exec(text)) !== null) {
    // Push any plain text between tokens (whitespace / newlines).
    if (m.index > last) {
      nodes.push(text.slice(last, m.index));
    }

    if (m[1] != null) {
      // Property key  (string followed by colon)
      nodes.push(
        <span key={key++} className="text-info">
          {m[1]}
        </span>,
      );
      // The colon itself
      nodes.push(
        <span key={key++} className="text-muted-foreground">
          {m[2]}
        </span>,
      );
    } else if (m[3] != null) {
      // String value
      nodes.push(
        <span key={key++} className="text-success">
          {m[3]}
        </span>,
      );
    } else if (m[4] != null) {
      // Number
      nodes.push(
        <span key={key++} className="text-warning">
          {m[4]}
        </span>,
      );
    } else if (m[5] != null) {
      // Boolean (true / false)
      nodes.push(
        <span key={key++} className="text-warning">
          {m[5]}
        </span>,
      );
    } else if (m[6] != null) {
      // null
      nodes.push(
        <span key={key++} className="text-muted-foreground">
          {m[6]}
        </span>,
      );
    } else if (m[7] != null) {
      // Structural: { } [ ] , :
      nodes.push(
        <span key={key++} className="text-muted-foreground">
          {m[7]}
        </span>,
      );
    }

    last = m.index + m[0].length;
  }

  // Trailing text (shouldn't happen in well-formed JSON, but be safe).
  if (last < text.length) {
    nodes.push(text.slice(last));
  }

  return nodes;
}
