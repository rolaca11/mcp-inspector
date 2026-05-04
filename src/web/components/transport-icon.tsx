import { Globe, Terminal, Radio } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Transport } from "@/data/types";

interface TransportIconProps {
  transport: Transport;
  className?: string;
}

export function TransportIcon({ transport, className }: TransportIconProps) {
  const Icon =
    transport === "stdio"
      ? Terminal
      : transport === "sse"
      ? Radio
      : Globe;
  return <Icon className={cn("size-3.5", className)} />;
}

export function transportLabel(t: Transport): string {
  switch (t) {
    case "stdio":
      return "stdio";
    case "http":
      return "HTTP";
    case "sse":
      return "SSE";
    case "streamable-http":
      return "Streamable HTTP";
  }
}
