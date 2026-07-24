import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

const Select = SelectPrimitive.Root
const SelectGroup = SelectPrimitive.Group
const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-9 w-full items-center justify-between gap-2 rounded-lg border px-3",
      "text-sm tracking-normal leading-snug",
      "border-[var(--line)] bg-[var(--surface)] text-[var(--ink)]",
      "ring-offset-[var(--bg)]",
      "hover:border-[var(--line-2)]",
      "focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-1 focus:border-[var(--accent)]",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "transition-[border-color,box-shadow] duration-150",
      "[&>span]:whitespace-normal [&>span]:break-words",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--ink-3)', opacity: 0.7 }} />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectContent = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", collisionPadding = 80, ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      collisionPadding={collisionPadding}
      className={cn(
        // z-[400] = var(--z-popover): above sticky/bottom-nav (100) and below modals (300+)
        "relative z-[400] max-h-72 min-w-[8rem] overflow-hidden",
        "rounded-xl border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)]",
        // Refined shadow — deeper than --sh-sm but softer than --sh-lg
        "shadow-[0_8px_24px_-4px_rgba(10,10,10,0.12),0_2px_6px_-1px_rgba(10,10,10,0.06)]",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        position === "popper" && "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className
      )}
      position={position}
      {...props}
    >
      <SelectPrimitive.Viewport
        className={cn("p-1", position === "popper" && "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]")}
      >
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectItem = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-md",
      "min-h-9 py-2 pl-8 pr-3",
      "text-sm leading-snug tracking-normal text-[var(--ink-2)]",
      "outline-none transition-colors duration-100",
      "focus:bg-[var(--surface-2)] focus:text-[var(--ink)]",
      "data-[state=checked]:text-[var(--ink)] data-[state=checked]:font-medium",
      "data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-3.5 w-3.5" style={{ color: 'var(--accent)' }} />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

export { Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectItem }
