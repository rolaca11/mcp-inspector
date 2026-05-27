import * as React from "react";
import { Check, Copy, Minimize2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { JsonTree } from "@/components/json-tree";

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
  const [copiedMinified, setCopiedMinified] = React.useState(false);

  const onCopy = React.useCallback(() => {
    void navigator.clipboard.writeText(children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [children]);

  const isJson =
    language === "json" ||
    language === "application/json" ||
    language?.endsWith("+json");

  const jsonData = React.useMemo(() => {
    if (!isJson) return undefined;
    try {
      return JSON.parse(children) as unknown;
    } catch {
      return undefined;
    }
  }, [isJson, children]);

  const minifiedJson = React.useMemo(() => {
    if (jsonData === undefined) return null;
    return JSON.stringify(jsonData);
  }, [jsonData]);

  const onCopyMinified = React.useCallback(() => {
    if (minifiedJson == null) return;
    void navigator.clipboard.writeText(minifiedJson).then(() => {
      setCopiedMinified(true);
      setTimeout(() => setCopiedMinified(false), 1200);
    });
  }, [minifiedJson]);

  const isTreeView = jsonData !== undefined;
  const hasCollapsibles =
    isTreeView && typeof jsonData === "object" && jsonData !== null;
  const canCopyMinified = copyable && minifiedJson != null;

  const [treeKey, setTreeKey] = React.useState(0);
  const [defaultCollapsed, setDefaultCollapsed] = React.useState(false);

  const onFoldAll = React.useCallback(() => {
    setDefaultCollapsed(true);
    setTreeKey((k) => k + 1);
  }, []);

  const onUnfoldAll = React.useCallback(() => {
    setDefaultCollapsed(false);
    setTreeKey((k) => k + 1);
  }, []);

  const highlighted = React.useMemo(
    () => (isJson && !isTreeView ? highlightJson(children) : null),
    [isJson, isTreeView, children],
  );

  return (
    <div className={cn("group rounded-lg border border-border/60 bg-card/40 overflow-hidden", className)}>
      {(caption || language || copyable || canCopyMinified) && (
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2 text-xs text-muted-foreground/80 font-mono">
          <span className="min-w-0 truncate">
            {caption ?? language ?? ""}
          </span>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {hasCollapsibles && (
              <>
                <button
                  type="button"
                  onClick={onFoldAll}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-muted/70 hover:text-foreground cursor-pointer"
                >
                  fold
                </button>
                <button
                  type="button"
                  onClick={onUnfoldAll}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-muted/70 hover:text-foreground cursor-pointer"
                >
                  unfold
                </button>
              </>
            )}
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
            {canCopyMinified && (
              <button
                type="button"
                onClick={onCopyMinified}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-muted/70 hover:text-foreground cursor-pointer"
                aria-label="Copy minified JSON"
              >
                {copiedMinified ? (
                  <>
                    <Check className="size-3 text-success" />
                    <span>copied</span>
                  </>
                ) : (
                  <>
                    <Minimize2 className="size-3" />
                    <span>copy minified</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}
      <pre className="overflow-x-auto p-4 text-sm leading-relaxed font-mono text-foreground/90">
        <code>
          {isTreeView ? (
            <JsonTree
              key={treeKey}
              data={jsonData}
              defaultCollapsed={defaultCollapsed}
            />
          ) : (
            highlighted ?? children
          )}
        </code>
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lightweight JSON syntax highlighting (fallback for malformed JSON)  */
/* ------------------------------------------------------------------ */

const JSON_TOKEN =
  /("(?:[^"\\]|\\.)*")\s*(:)|("(?:[^"\\]|\\.)*")|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|(true|false)|(null)|([{}[\]:,])/g;

function highlightJson(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;

  JSON_TOKEN.lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = JSON_TOKEN.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(text.slice(last, m.index));
    }

    if (m[1] != null) {
      nodes.push(
        <span key={key++} className="text-info">
          {m[1]}
        </span>,
      );
      nodes.push(
        <span key={key++} className="text-muted-foreground">
          {m[2]}
        </span>,
      );
    } else if (m[3] != null) {
      nodes.push(
        <span key={key++} className="text-success">
          {m[3]}
        </span>,
      );
    } else if (m[4] != null) {
      nodes.push(
        <span key={key++} className="text-warning">
          {m[4]}
        </span>,
      );
    } else if (m[5] != null) {
      nodes.push(
        <span key={key++} className="text-warning">
          {m[5]}
        </span>,
      );
    } else if (m[6] != null) {
      nodes.push(
        <span key={key++} className="text-muted-foreground">
          {m[6]}
        </span>,
      );
    } else if (m[7] != null) {
      nodes.push(
        <span key={key++} className="text-muted-foreground">
          {m[7]}
        </span>,
      );
    }

    last = m.index + m[0].length;
  }

  if (last < text.length) {
    nodes.push(text.slice(last));
  }

  return nodes;
}
