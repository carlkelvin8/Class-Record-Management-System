import * as React from "react";
import { cn } from "../../lib/utils";
export const Input = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input">
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-11 w-full rounded-md border border-border bg-white px-3.5 text-sm transition-shadow duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
