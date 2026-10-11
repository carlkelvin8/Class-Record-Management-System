import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";
export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "surface-card rounded-lg border border-border bg-white",
        className,
      )}
      {...props}
    />
  );
}
