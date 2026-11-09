import * as React from "react"

/**
 * Below `lg` (1024 px) the sidebar is a sheet: phones and tablets in portrait get the page's full width.
 * Keep it in step with the `lg:` classes that dock the sidebar (`components/ui/sidebar.tsx`) and frame the
 * panel (the shell layout).
 */
const MOBILE_BREAKPOINT = 1024

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
