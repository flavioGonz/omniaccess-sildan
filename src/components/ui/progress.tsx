import * as React from "react"
import { cn } from "@/lib/utils"

const Progress = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement> & { value?: number, indicatorClassName?: string }
>(({ className, value, indicatorClassName, ...props }, ref) => (
    <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className={cn(
            "relative h-2 w-full overflow-hidden rounded-full bg-neutral-900",
            className
        )}
        {...props}
    >
        <div
            className={cn(
                "h-full w-full flex-1 bg-white transition-all duration-500 ease-in-out",
                indicatorClassName
            )}
            style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
        />
    </div>
))
Progress.displayName = "Progress"

export { Progress }
