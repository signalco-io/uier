"use client"

import { useAppI18n } from "@/src/lib/i18n/client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

// Success, warning and error toasts take their state's colour: the icon in the colour and the
// surface and border tinted with it, so the state reads at a glance. Text stays the popover's
// foreground for contrast. Info stays neutral, since blue is the accent (links, focus, unread).
// The classes are written out in full so Tailwind finds them.
const tinted = {
  success: "[--normal-bg:color-mix(in_srgb,hsl(var(--brand-success))_8%,hsl(var(--popover)))] [--normal-border:color-mix(in_srgb,hsl(var(--brand-success))_35%,hsl(var(--border)))]",
  warning: "[--normal-bg:color-mix(in_srgb,hsl(var(--brand-warning))_8%,hsl(var(--popover)))] [--normal-border:color-mix(in_srgb,hsl(var(--brand-warning))_35%,hsl(var(--border)))]",
  error: "[--normal-bg:color-mix(in_srgb,hsl(var(--destructive))_8%,hsl(var(--popover)))] [--normal-border:color-mix(in_srgb,hsl(var(--destructive))_35%,hsl(var(--border)))]",
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { t } = useAppI18n()
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      containerAriaLabel={t("Notifications")}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4 text-[hsl(var(--brand-success))]" />
        ),
        info: (
          <InfoIcon className="size-4 text-muted-foreground" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4 text-[hsl(var(--brand-warning))]" />
        ),
        error: (
          <OctagonXIcon className="size-4 text-[hsl(var(--destructive))] dark:text-[color-mix(in_srgb,hsl(var(--destructive))_55%,white)]" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "hsl(var(--popover))",
          "--normal-text": "hsl(var(--popover-foreground))",
          "--normal-border": "hsl(var(--border))",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        closeButtonAriaLabel: t("Close toast"),
        classNames: {
          toast: "cn-toast",
          success: tinted.success,
          warning: tinted.warning,
          error: tinted.error,
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
