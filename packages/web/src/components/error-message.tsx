import { useMemo } from "react";
import { AlertCircle, Link2, RotateCw } from "lucide-react";

import type { ElicitationUrlParams } from "@rolaca11/mcp-inspector-core/elicitation";

import { CodeBlock } from "@/components/code-block";
import { UrlElicitationDetails } from "@/components/elicitation-panel";
import { Button } from "@/components/ui/button";

function findJsonStart(s: string): number {
  const brace = s.indexOf("{");
  const bracket = s.indexOf("[");
  if (brace === -1) return bracket;
  if (bracket === -1) return brace;
  return Math.min(brace, bracket);
}

export function ErrorMessage({
  error,
  errorResponse,
  urlElicitations,
  onRetry,
}: {
  error: string;
  errorResponse?: Record<string, unknown>;
  urlElicitations?: ElicitationUrlParams[];
  onRetry?: () => void;
}) {
  const { prefix, json } = useMemo(() => {
    if (errorResponse) return { prefix: error, json: null };
    const idx = findJsonStart(error);
    if (idx === -1) return { prefix: error, json: null };
    try {
      const parsed = JSON.parse(error.slice(idx));
      return { prefix: error.slice(0, idx).trim(), json: JSON.stringify(parsed, null, 2) };
    } catch {
      return { prefix: error, json: null };
    }
  }, [error, errorResponse]);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
        <AlertCircle className="size-4 mt-0.5 text-destructive shrink-0" />
        <span className="break-all">{prefix || error}</span>
      </div>
      {urlElicitations && urlElicitations.length > 0 && (
        <div className="space-y-3 rounded-md border border-info/30 bg-info/5 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-info">
            <Link2 className="size-4" />
            The server needs you to open{" "}
            {urlElicitations.length === 1 ? "a link" : `${urlElicitations.length} links`} first
          </div>
          {urlElicitations.map((elicitation, i) => (
            <div
              key={elicitation.elicitationId ?? `${i}-${elicitation.url}`}
              className="space-y-2 rounded-md border border-border/60 bg-card/40 p-3"
              data-testid="url-elicitation-card"
            >
              {elicitation.message && (
                <p className="whitespace-pre-wrap break-words text-sm text-foreground/85">{elicitation.message}</p>
              )}
              <UrlElicitationDetails params={elicitation} />
            </div>
          ))}
          {onRetry && (
            <Button type="button" size="sm" variant="success" onClick={onRetry}>
              <RotateCw className="size-3.5" />
              Retry
            </Button>
          )}
        </div>
      )}
      {errorResponse && (
        <CodeBlock language="application/json" caption="Error response">
          {JSON.stringify(errorResponse, null, 2)}
        </CodeBlock>
      )}
      {json && (
        <CodeBlock language="application/json" caption="Error response">
          {json}
        </CodeBlock>
      )}
    </div>
  );
}
