import { ArrowRight, MessageSquareMore } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { MCPServer } from "@/data/types";
import { useElicitationStore } from "@/stores/elicitation-store";

export function ElicitationBanner({
  servers,
  active,
  onSelectServer,
}: {
  servers: MCPServer[];
  active: MCPServer;
  onSelectServer: (server: MCPServer) => void;
}) {
  const pending = useElicitationStore((s) => s.pending);
  const submittingId = useElicitationStore((s) => s.submittingId);
  const respond = useElicitationStore((s) => s.respond);

  const elsewhere = new Map<string, string[]>();
  for (const p of pending) {
    if (p.serverName !== active.id) {
      const ids = elsewhere.get(p.serverName) ?? [];
      ids.push(p.id);
      elsewhere.set(p.serverName, ids);
    }
  }

  if (elsewhere.size === 0) return null;

  return (
    <div className="shrink-0 divide-y divide-info/20 border-b border-info/30 bg-info/10 text-sm text-info">
      {[...elsewhere].map(([serverName, ids]) => {
        const target = servers.find((s) => s.id === serverName);
        return (
          <div key={serverName} className="flex items-center gap-2.5 px-4 py-1.5 sm:px-6">
            <MessageSquareMore className="size-4 shrink-0" />
            <span className="min-w-0 truncate">
              <span className="font-mono">{serverName}</span> is waiting for your input
              {ids.length > 1 ? ` (${ids.length} requests)` : ""}
            </span>
            {target ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="ml-auto h-7 shrink-0"
                onClick={() => onSelectServer(target)}
              >
                Switch to {target.id}
                <ArrowRight className="size-3.5" />
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="ml-auto h-7 shrink-0"
                disabled={submittingId !== null}
                onClick={() => {
                  for (const id of ids) void respond(id, "cancel");
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
