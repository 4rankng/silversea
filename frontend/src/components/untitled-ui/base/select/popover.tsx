
import type { RefAttributes } from "react";
import type { PopoverProps as AriaPopoverProps } from "react-aria-components";
import { Popover as AriaPopover } from "react-aria-components";
import { cx } from "@/utils/cx";

interface PopoverProps extends AriaPopoverProps, RefAttributes<HTMLElement> {
    size: "sm" | "md" | "lg";
}

export const Popover = (props: PopoverProps) => {
    // Bound the popover height even when no explicit size is passed: an
    // unbounded popover can span thousands of pixels below the trigger,
    // defeating react-aria's shouldFlip and covering every control under
    // the fold (the "dropdown covers + Thêm" bug class).
    const maxHeightClass = props.size === "sm"
        ? "max-h-56!"
        : props.size === "md"
            ? "max-h-64!"
            : props.size === "lg"
                ? "max-h-80!"
                : "max-h-72!";

    return (
        <AriaPopover
            placement="bottom"
            containerPadding={16}
            offset={4}
            {...props}
            className={(state) =>
                cx(
                    "w-(--trigger-width) origin-(--trigger-anchor-point) overflow-x-hidden overflow-y-auto rounded-lg border border-secondary bg-primary py-1 outline-hidden will-change-transform",

                    state.isEntering &&
                        "duration-150 ease-out animate-in fade-in placement-right:slide-in-from-left-0.5 placement-top:slide-in-from-bottom-0.5 placement-bottom:slide-in-from-top-0.5",
                    state.isExiting &&
                        "duration-100 ease-in animate-out fade-out placement-right:slide-out-to-left-0.5 placement-top:slide-out-to-bottom-0.5 placement-bottom:slide-out-to-top-0.5",

                    maxHeightClass,

                    typeof props.className === "function" ? props.className(state) : props.className,
                )
            }
        />
    );
};
