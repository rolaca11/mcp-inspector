import { useMemo } from "react";
import { AlertCircle } from "lucide-react";

import { CodeBlock } from "@/components/code-block";

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
}: {
  error: string;
  errorResponse?: Record<string, unknown>;
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
