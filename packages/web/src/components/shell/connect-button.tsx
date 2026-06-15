import { Loader2, Plug, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ConnectionState } from "@/stores/connection-store";

/**
 * Connection control. Connected → a compact refresh (re-discover) icon button;
 * connecting → disabled spinner; otherwise a solid "success" action button (the
 * same green used for every primary action across the app).
 */
export function ConnectButton({
  state,
  onConnect,
  onRediscover,
}: {
  state: ConnectionState;
  onConnect: () => void;
  onRediscover: () => void;
}) {
  if (state === "connecting") {
    return (
      <Button size="sm" variant="secondary" disabled className="gap-1.5">
        <Loader2 className="size-3.5 animate-spin" />
        Connecting…
      </Button>
    );
  }

  if (state === "connected") {
    return (
      <button
        type="button"
        onClick={onRediscover}
        aria-label="Re-discover server"
        title="Re-discover"
        className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <RefreshCw className="size-4" />
      </button>
    );
  }

  return (
    <Button size="sm" variant="success" className="gap-1.5" onClick={onConnect}>
      <Plug className="size-3.5" />
      {state === "error" ? "Retry" : "Connect"}
    </Button>
  );
}
