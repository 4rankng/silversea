
import type { CSSProperties, RefAttributes } from "react";
import type { PopoverProps as AriaPopoverProps } from "react-aria-components";
import { Popover as AriaPopover } from "react-aria-components";
import { cx } from "@/utils/cx";

interface PopoverProps extends AriaPopoverProps, RefAttributes<HTMLElement> {
    size: "sm" | "md" | "lg";
}

/** Height caps per size, mirroring the retired `max-h-*!` classes (px). */
const SIZE_CAP: Record<string, number> = { sm: 224, md: 256, lg: 320 };
const DEFAULT_CAP = 288;
/** Below this much usable space the list would collapse to a sliver — let
 *  react-aria flip above instead (the card's "trừ khi không còn không gian
 *  hiển thị"). */
const FIT_FLOOR = 96;

/**
 * Fit-to-space cap (card 061026172802 — FB-025/FB-044): the largest
 * max-height that lets the popover open BELOW its trigger, or null when the
 * space below is too small to be usable. Pure so the geometry contract stays
 * unit-tested.
 */
export function fitBelowMaxHeight(
    viewportHeight: number,
    triggerBottom: number,
    cap: number,
    containerPadding: number,
    offset: number,
    floor: number = FIT_FLOOR,
): number | null {
    const below = viewportHeight - triggerBottom - containerPadding - offset;
    if (below < floor) return null;
    return Math.max(floor, Math.min(cap, Math.floor(below)));
}

export const Popover = (props: PopoverProps) => {
    const cap = SIZE_CAP[props.size] ?? DEFAULT_CAP;
    // Fit-to-space: measure the trigger synchronously at popover mount (the
    // overlay is transient and remounts per open, so the first positioning
    // pass already sees the bounded height and stays below the trigger
    // whenever the leftover space is usable — instead of flipping above and
    // covering the fields there). The value rides a CSS variable consumed by
    // the `!` max-height class: react-aria assigns its own positioning
    // max-height inline AFTER the user style, so a plain inline max-height
    // loses — but it never touches custom properties or class importance.
    const triggerRect = props.triggerRef?.current?.getBoundingClientRect();
    const belowSpace = triggerRect
        ? fitBelowMaxHeight(window.innerHeight, triggerRect.bottom, cap, props.containerPadding ?? 16, props.offset ?? 4)
        : null;
    const fitVarStyle = { ...props.style, "--popover-fit": `${belowSpace ?? cap}px` } as CSSProperties;
    // The `!` max-height class consumes the fit variable set above. An inline
    // max-height loses to react-aria's own positioning style (it assigns
    // inline after the user style), but class importance beats that inline
    // and react-aria never touches custom properties — so the fit survives.
    const maxHeightClass = "max-h-(--popover-fit,16rem)!";

    return (
        <AriaPopover
            placement="bottom"
            containerPadding={16}
            offset={4}
            {...props}
            style={fitVarStyle}
            className={(state) =>
                cx(
                    "w-(--trigger-width) origin-(--trigger-anchor-point) overflow-x-hidden overflow-y-auto rounded-lg border border-secondary bg-[var(--surface)] py-1 outline-hidden will-change-transform",

                    state.isEntering &&
                        "duration-150 ease-out animate-in fade-in placement-right:slide-in-from-left-0.5 placement-top:slide-in-from-bottom-0.5 placement-bottom:slide-in-from-top-0.5",
                    state.isExiting &&
                        "pointer-events-none duration-100 ease-in animate-out fade-out placement-right:slide-out-to-left-0.5 placement-top:slide-out-to-bottom-0.5 placement-bottom:slide-out-to-top-0.5",

                    maxHeightClass,

                    typeof props.className === "function" ? props.className(state) : props.className,
                )
            }
        />
    );
};
