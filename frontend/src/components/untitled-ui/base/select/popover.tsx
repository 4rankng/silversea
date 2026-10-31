
import type { CSSProperties, RefAttributes } from "react";
import { useEffect, useRef } from "react";
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

/** Consecutive identical rects before the overlay counts as settled. */
const SETTLE_FRAMES = 2;
/** Hard cap so a pathological mover can never lock the popover shut. */
const MAX_GATE_FRAMES = 30;

/**
 * SIL-630 (id 734): react-aria positions the overlay with a POST-mount pass,
 * so the first painted frames can sit displaced from the rect the browser
 * actually hit-tests — on the create-form LOẠI container picker the listbox
 * first painted roughly two option-rows away from its settled spot, and an
 * operator aiming at the painted "20DC" row committed the row that really
 * lived under the cursor ("20RF"); every pick landed exactly +2 positions
 * down the catalog. The same entry-slide animation moves the paint again.
 *
 * Law (the card's own "hidden until measured" rule, ported to the overlay):
 * pointer events stay OFF until the element's rect is identical for
 * SETTLE_FRAMES consecutive frames — a too-early click is swallowed instead
 * of committing a neighbour row. Capped at MAX_GATE_FRAMES so nothing can
 * lock a popover shut; the overlay remounts per open, so the gate re-arms
 * every time.
 */
function useSettledPointerEvents(ref: React.RefObject<HTMLElement | null>) {
    useEffect(() => {
        // AriaPopover does not forward a ref to its portal element, so the
        // gate renders a hidden marker and walks up to the real overlay.
        const el = ref.current?.parentElement ?? null;
        if (!el || !(el instanceof HTMLElement)) return;
        el.style.pointerEvents = "none";
        el.setAttribute("data-popover-gate", "settling");
        let last: { top: number; left: number; width: number; height: number } | null = null;
        let stable = 0;
        let frames = 0;
        let raf = 0;
        const settle = () => {
            el.style.pointerEvents = "";
            el.setAttribute("data-popover-gate", "settled");
        };
        const tick = () => {
            const rect = el.getBoundingClientRect();
            const isSame = last != null
                && last.top === rect.top
                && last.left === rect.left
                && last.width === rect.width
                && last.height === rect.height;
            last = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
            stable = isSame ? stable + 1 : 0;
            frames += 1;
            if (stable >= SETTLE_FRAMES || frames >= MAX_GATE_FRAMES) {
                settle();
                return;
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => {
            cancelAnimationFrame(raf);
            settle();
        };
    }, [ref]);
}

/**
 * SIL-630 settle gate — MUST be a component rendered INSIDE the overlay: the
 * overlay (and the marker) enter the DOM only when react-aria opens it, so a
 * hook on the Popover component itself would read a null ref (its own effect
 * ran at form-render time, long before the overlay existed). As a child,
 * the gate's effect fires exactly when the marker enters the DOM, on every
 * open.
 */
function PopoverSettleGate() {
    const gateRef = useRef<HTMLSpanElement | null>(null);
    useSettledPointerEvents(gateRef);
    return <span ref={gateRef} hidden aria-hidden="true" data-popover-settle-gate="" />;
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

    // SIL-630: the gate rides INSIDE the overlay's children — function
    // children (render props) get it appended after their output so both
    // child shapes keep type-checking.
    const { children } = props;
    const gate = <PopoverSettleGate />;
    const mergedChildren = typeof children === "function"
        ? (values: Parameters<NonNullable<typeof children>>[0]) => (
            <>
                {children(values)}
                {gate}
            </>
        )
        : (
            <>
                {children}
                {gate}
            </>
        );

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
        >
            {mergedChildren}
        </AriaPopover>
    );
};
