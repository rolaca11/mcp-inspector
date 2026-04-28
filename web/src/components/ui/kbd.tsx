import * as React from "react";

import { cn } from "@/lib/utils";

function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center justify-center min-w-[1.4rem] h-[1.4rem] px-1.5 text-[10px] font-medium tracking-wider text-muted-foreground bg-muted/50 border border-border/60 rounded-md font-mono",
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
