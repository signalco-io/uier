"use client"

// shadcn/ui has no autocomplete: this follows its Combobox (`shadcn add combobox`, also Base UI)
// part for part, on Base UI's Autocomplete, whose value is the typed text and whose items only
// suggest it. Use Combobox when the value must be one of the items.

import * as React from "react"
import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete"
import { cn } from "cn"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/src/components/ui/input-group"
import { ChevronDownIcon } from "lucide-react"

const Autocomplete = AutocompletePrimitive.Root

function AutocompleteTrigger({
  className,
  children,
  ...props
}: AutocompletePrimitive.Trigger.Props) {
  return (
    <AutocompletePrimitive.Trigger
      data-slot="autocomplete-trigger"
      className={cn("[&_svg:not([class*='size-'])]:size-4", className)}
      {...props}
    >
      {children}
      <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
    </AutocompletePrimitive.Trigger>
  )
}

function AutocompleteInput({
  className,
  children,
  disabled = false,
  showTrigger = true,
  triggerLabel = "Show suggestions",
  ...props
}: AutocompletePrimitive.Input.Props & {
  showTrigger?: boolean
  /** The trigger's accessible name (it only has an icon) */
  triggerLabel?: string
}) {
  return (
    // Base UI's input group, rendered as ours: the popup anchors to the whole field
    <AutocompletePrimitive.InputGroup
      render={<InputGroup className={cn("w-auto", className)} />}
    >
      <AutocompletePrimitive.Input
        render={<InputGroupInput disabled={disabled} />}
        {...props}
      />
      {showTrigger && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            variant="ghost"
            asChild
            data-slot="input-group-button"
            className="data-pressed:bg-transparent"
            disabled={disabled}
          >
            <AutocompleteTrigger aria-label={triggerLabel} />
          </InputGroupButton>
        </InputGroupAddon>
      )}
      {children}
    </AutocompletePrimitive.InputGroup>
  )
}

function AutocompleteContent({
  className,
  side = "bottom",
  sideOffset = 6,
  align = "start",
  alignOffset = 0,
  anchor,
  ...props
}: AutocompletePrimitive.Popup.Props &
  Pick<
    AutocompletePrimitive.Positioner.Props,
    "side" | "align" | "sideOffset" | "alignOffset" | "anchor"
  >) {
  return (
    <AutocompletePrimitive.Portal>
      <AutocompletePrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="isolate z-50"
      >
        <AutocompletePrimitive.Popup
          data-slot="autocomplete-content"
          className={cn(
            "group/autocomplete-content relative max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) origin-(--transform-origin) overflow-hidden rounded-md bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        />
      </AutocompletePrimitive.Positioner>
    </AutocompletePrimitive.Portal>
  )
}

function AutocompleteList({
  className,
  ...props
}: AutocompletePrimitive.List.Props) {
  return (
    <AutocompletePrimitive.List
      data-slot="autocomplete-list"
      className={cn(
        "no-scrollbar max-h-[min(calc(--spacing(72)---spacing(9)),calc(var(--available-height)---spacing(9)))] scroll-py-1 overflow-y-auto overscroll-contain p-1 data-empty:p-0",
        className
      )}
      {...props}
    />
  )
}

function AutocompleteItem({
  className,
  ...props
}: AutocompletePrimitive.Item.Props) {
  return (
    <AutocompletePrimitive.Item
      data-slot="autocomplete-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function AutocompleteEmpty({
  className,
  ...props
}: AutocompletePrimitive.Empty.Props) {
  return (
    <AutocompletePrimitive.Empty
      data-slot="autocomplete-empty"
      className={cn(
        "hidden w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground group-data-empty/autocomplete-content:flex [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

export {
  Autocomplete,
  AutocompleteInput,
  AutocompleteContent,
  AutocompleteList,
  AutocompleteItem,
  AutocompleteEmpty,
  AutocompleteTrigger,
}
