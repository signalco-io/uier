import { cn } from "cn"
import { Loader2Icon } from "lucide-react"

/**
 * One spinner for every loading state (uier #441). Its default 16 px is `w-4 h-4`, not `size-4`: a button's
 * `[&_svg:not([class*='size-'])]` rule then sizes it like the icon it replaces (12 px in `xs` and `icon-xs`),
 * so a pending button's spinner matches a column's progress spinner beside it. A `size-*` class still overrides it.
 */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon data-slot="spinner" aria-hidden="true" className={cn("h-4 w-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
