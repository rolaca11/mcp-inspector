import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium leading-none whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-border/60 bg-card/50 text-foreground",
        secondary:
          "border-border/60 bg-secondary text-secondary-foreground",
        outline:
          "border-border/60 text-muted-foreground",
        success:
          "border-success/30 bg-success/10 text-success",
        warning:
          "border-warning/30 bg-warning/10 text-warning",
        info: "border-info/30 bg-info/10 text-info",
        destructive:
          "border-destructive/30 bg-destructive/10 text-destructive",
        muted:
          "border-border/40 bg-muted/40 text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

interface BadgeProps
  extends React.ComponentProps<"span">,
    VariantProps<typeof badgeVariants> {
  asChild?: boolean;
}

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: BadgeProps) {
  const Comp = asChild ? Slot : "span";
  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant, className }))}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
