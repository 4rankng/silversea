
import type { FC, FocusEventHandler, MouseEventHandler, PointerEventHandler, ReactNode, Ref, RefAttributes, RefObject } from "react";
import { isValidElement, useCallback, useContext, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { SearchLg, XClose } from "@untitledui/icons";
import type { ComboBoxProps as AriaComboBoxProps, GroupProps as AriaGroupProps, ListBoxProps as AriaListBoxProps } from "react-aria-components";
import { ComboBox as AriaComboBox, Group as AriaGroup, Input as AriaInput, ListBox as AriaListBox, ComboBoxStateContext } from "react-aria-components";
import { HintText } from "@/components/untitled-ui/base/input/hint-text";
import { Label } from "@/components/untitled-ui/base/input/label";
import { Popover } from "@/components/untitled-ui/base/select/popover";
import { type CommonProps, SelectContext, type SelectItemType, sizes } from "@/components/untitled-ui/base/select/select-shared";
import { useResizeObserver } from "@/hooks/use-resize-observer";
import { cx } from "@/utils/cx";
import { isReactComponent } from "@/utils/is-react-component";
import "./combobox.css";

interface ComboBoxProps extends Omit<AriaComboBoxProps<SelectItemType>, "children" | "items">, RefAttributes<HTMLDivElement>, CommonProps {
    shortcut?: boolean;
    items?: SelectItemType[];
    popoverClassName?: string;
    shortcutClassName?: string;
    /** Leading icon component displayed before the input. */
    icon?: FC | ReactNode;
    /** Open the options when the input group is clicked or touched. */
    openOnPress?: boolean;
    /** Extra classes for the trigger group — the element that actually renders the visible boundary. */
    triggerClassName?: string;
    /** Called when the user clicks the clear (X) button. */
    onClear?: () => void;
    /**
     * Bare-Enter commit for type-to-search fields (20260922_4). When the menu
     * is open, the input is focused and NO option is highlighted (no
     * aria-activedescendant), the owner may commit the unique filtered match:
     * return the {id, label} to commit, or null when the text matches nothing
     * or matches ambiguously — the event is then swallowed so react-aria's
     * Enter settle (which re-fires the old selection and wipes the typed
     * text) never runs. An option highlighted via ArrowDown is unaffected.
     */
    onEnterCommit?: (typedText: string) => { id: string; label: string } | null;
    /**
     * Initial placement hint for the popover relative to the trigger. Useful
     * when the picker sits inside a column that has a sibling action button
     * (e.g. "+ Thêm") right below — request "top" so the popover opens
     * upward and never covers the sibling. `shouldFlip` stays on, so when the
     * trigger is jammed against the top edge the popover still flips back
     * down rather than clipping off-screen.
     */
    popoverPlacement?: 'top' | 'bottom' | 'left' | 'right' | 'top start' | 'top end' | 'bottom start' | 'bottom end' | 'start' | 'end';
    children: AriaListBoxProps<SelectItemType>["children"];
}

interface ComboBoxValueProps extends AriaGroupProps {
    size: "sm" | "md" | "lg";
    shortcut: boolean;
    placeholder?: string;
    shortcutClassName?: string;
    icon?: FC | ReactNode;
    openOnPress?: boolean;
    allowsCustomValue?: boolean;
    triggerClassName?: string;
    onClear?: () => void;
    onFocus?: FocusEventHandler;
    onPointerEnter?: PointerEventHandler;
    ref?: Ref<HTMLDivElement>;
}

const ComboBoxValue = ({ size, shortcut, placeholder, shortcutClassName, icon: IconProp, openOnPress, allowsCustomValue, triggerClassName, onClear, onEnterCommit, ref, onEscapeClose, containerRef, ...otherProps }: ComboBoxValueProps & { onEscapeClose?: () => void; containerRef?: RefObject<HTMLDivElement | null>; onEnterCommit?: (typedText: string) => { id: string; label: string } | null }) => {
    const state = useContext(ComboBoxStateContext);
    // True from the last explicit option-navigation key until the next typing
    // key or a consumed Enter — see the keydown-capture handler below.
    const navigatedHighlightedRef = useRef(false);

    const value = state?.selectedItem?.value || (state?.selectedKey != null ? { id: state.selectedKey } : null);
    const inputValue = state?.inputValue || null;
    const selectedLabel = state?.selectedItem?.value?.label ?? state?.selectedItem?.textValue ?? "";
    const hasClearableValue = Boolean(value || (state?.selectedKey != null && state.selectedKey !== '') || (inputValue && inputValue.trim().length > 0));

    const first = inputValue?.split(value?.supportingText)?.[0] || "";
    const last = inputValue?.split(first)[1];

    const handleClick: MouseEventHandler<HTMLDivElement> = (event) => {
        otherProps.onClick?.(event);
        if (openOnPress && !event.defaultPrevented && !state?.isOpen) state?.open(null, "manual");
    };

    return (
        <AriaGroup
            ref={ref}
            {...otherProps}
            onClick={handleClick}
            data-size={size}
            data-uui-control="combobox"
            data-control-size={size}
            data-default-search-icon={IconProp == null || (!isReactComponent(IconProp) && !isValidElement(IconProp)) ? true : undefined}
            className={({ isFocusWithin, isDisabled }) =>
                cx(
                    "uui-combobox relative flex w-full items-center rounded-lg border border-primary bg-primary outline-focus-ring transition duration-100 ease-linear",
                    isDisabled && "cursor-not-allowed opacity-50",
                    isFocusWithin && "border-brand outline-2 outline-offset-1",
                    triggerClassName,
                )
            }
        >
            {/*
             * `sizes[size].root` (padding + min-height) lives on this inner wrapper,
             * not on the AriaGroup above — mirroring Select, where the trigger
             * <button> carries no sizing of its own and simply grows to fit its
             * inner value span. That keeps a combobox and a plain select the same
             * rendered height for a given `size`: both are sized by one inner
             * flex element, with the outer boundary just auto-fitting around it.
             * (Putting `sizes[size].root`'s min-height directly on the group, as
             * before, stacked its own floor on top of the input's, rendering
             * ~18px taller than the equivalent select trigger.)
             */}
            <div
                ref={containerRef}
                data-combobox-value
                onKeyDownCapture={(event) => {
                    // Track explicit option navigation. react-aria AUTO-focuses
                    // the first filtered option when a type-to-search menu
                    // reopens (via KeepSuggestionsOpen), so a present
                    // aria-activedescendant alone does not mean the user chose
                    // to highlight — only explicit navigation makes Enter's
                    // highlighted-commit the user's own pick (20260922_4).
                    if (["ArrowDown", "ArrowUp", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
                        navigatedHighlightedRef.current = true;
                    } else if (event.key !== "Enter") {
                        navigatedHighlightedRef.current = false;
                    }
                    // Bare-Enter commit for type-to-search fields. Capture phase
                    // runs before the input's react-aria Enter shortcut, so a
                    // decision here preempts its settle (re-fire old selection +
                    // wipe typed text). A user-navigated highlight (ArrowDown…)
                    // is left to react-aria's own commit.
                    if (event.key === "Enter" && state?.isOpen && onEnterCommit) {
                        const input = containerRef?.current?.querySelector<HTMLInputElement>("input");
                        if (
                            input
                            && document.activeElement === input
                            && state.inputValue.trim() !== ""
                            && !(input.getAttribute("aria-activedescendant") && navigatedHighlightedRef.current)
                        ) {
                            const match = onEnterCommit(state.inputValue);
                            event.preventDefault();
                            event.stopPropagation();
                            if (match) {
                                // Same dance as Escape: flush the new text while
                                // the menu is still open so react-aria's render
                                // effect syncs `lastValue` — closing afterwards
                                // then cannot trip its input-change reopen.
                                flushSync(() => state.setInputValue(match.label));
                                state.setOpen(false);
                            } else if (input.getAttribute("aria-activedescendant")) {
                                // Ambiguous text with react-aria's auto-focused
                                // first match: drop the auto-highlight so a
                                // repeated Enter cannot commit the guess.
                                state.selectionManager?.setFocusedKey(null);
                            }
                        }
                        navigatedHighlightedRef.current = false;
                        return;
                    }
                    // Dismiss this list, not an enclosing editor. Synchronize
                    // controlled text before closing: an ignored null selection
                    // otherwise reopens a focus-triggered list with the old query.
                    if (event.key === "Escape" && state?.isOpen) {
                        event.preventDefault();
                        event.stopPropagation();
                        // Free text is already committed by custom-value callers.
                        // Catalog metadata is searchable, not its display label.
                        if (!allowsCustomValue && state.inputValue !== selectedLabel) {
                            // Let React Aria observe the restored text while open,
                            // before its input-change effect can reopen a closed list.
                            flushSync(() => state.setInputValue(selectedLabel));
                        }
                        // close() commits textValue (including search metadata).
                        // Escape only dismisses; it must not select or save again.
                        state.setOpen(false);
                        onEscapeClose?.();
                    }
                }}
                className={cx(
                    "flex w-full items-center gap-2",
                    // Icon styles
                    "*:data-icon:shrink-0 *:data-icon:text-fg-quaternary",
                    sizes[size].root,
                )}
            >
                {isReactComponent(IconProp) ? (
                    <IconProp data-icon className="pointer-events-none" aria-hidden="true" />
                ) : isValidElement(IconProp) ? (
                    IconProp
                ) : (
                    <SearchLg data-icon data-combobox-search className="pointer-events-none" aria-hidden="true" />
                )}

                <div className="uui-combobox__input relative flex min-w-0 w-full items-center">
                    {inputValue && (
                        <span className={cx("absolute top-1/2 z-0 inline-flex w-full -translate-y-1/2 truncate", sizes[size].textContainer)} aria-hidden="true">
                            <p className={cx("font-medium text-primary", sizes[size].text)}>{first}</p>
                            {last && <p className={cx("-ml-0.75 text-tertiary", sizes[size].text)}>{last}</p>}
                        </span>
                    )}

                    <AriaInput
                        placeholder={placeholder}
                        onFocus={(event) => {
                            // Clicking a committed value starts a replacement
                            // search; do not append the query to its old label.
                            if (state?.selectedKey != null && event.currentTarget.value === selectedLabel) {
                                event.currentTarget.select();
                            }
                        }}
                        className={cx(
                            "z-10 w-full appearance-none bg-transparent text-transparent caret-alpha-black/90 placeholder:text-placeholder focus:outline-hidden disabled:cursor-not-allowed",
                            sizes[size].text,
                            onClear && hasClearableValue && "pr-5",
                        )}
                        // The app's global `:focus-visible` rule (base.css) is unlayered, so it
                        // always beats the layered `focus:outline-hidden` utility above and draws
                        // its own outline directly on this input — nested inside the parent
                        // group's own focus ring (the one that actually communicates "focused"
                        // here). An inline style outranks any stylesheet rule, layered or not.
                        style={{ outline: 'none' }}
                    />
                </div>

                {onClear && hasClearableValue && (
                    <button
                        type="button"
                        tabIndex={-1}
                        aria-label="Xoá"
                        className="absolute right-1 z-20 flex shrink-0 items-center justify-center rounded p-0.5 text-secondary transition-colors hover:text-primary cursor-pointer"
                        onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                        }}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onClear();
                            state?.setSelectedKey(null);
                            state?.setInputValue('');
                        }}
                    >
                        <XClose className="size-3.5" />
                    </button>
                )}
            </div>

            {shortcut && (
                <div
                    className={cx(
                        "absolute inset-y-0.5 right-0.5 z-10 hidden items-center rounded-r-[inherit] bg-linear-to-r from-transparent to-bg-primary to-40% pl-8 md:flex",
                        sizes[size].shortcut,
                        shortcutClassName,
                    )}
                >
                    <span
                        className="pointer-events-none rounded px-1 py-px text-xs font-medium text-quaternary ring-1 ring-secondary select-none ring-inset"
                        aria-hidden="true"
                    >
                        ⌘K
                    </span>
                </div>
            )}
        </AriaGroup>
    );
};

/** Diacritic-insensitive text normalization so typing "que vo" matches
 *  "Quế Võ" in the option list. */
export function normalizeSearchText(value: string): string {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/Đ/g, "D")
        .toLocaleLowerCase("vi")
        .replace(/\s+/g, " ")
        .trim();
}

/** One filter for React Aria's results, keyboard navigation and open state.
 * Keep the complete collection mounted so filtering cannot remove a selected
 * item or make a second, unnormalized filter close otherwise valid results. */
export const matchesComboboxSearch = (text: string, inputValue: string): boolean => {
    const query = normalizeSearchText(inputValue);
    const searchableText = normalizeSearchText(text);
    return !query || query.split(" ").every((term) => searchableText.includes(term));
};

/**
 * 20260917_14: with allowsCustomValue, react-aria auto-selects an option whose
 * textValue exactly equals the typed input and closes the menu — killing the
 * suggestion list mid-word for free-text-plus-catalog fields. The controlled
 * selectedKey (still null while the user types) disagrees with that internal
 * auto-selection, which is how this watch tells them apart: it reopens the
 * menu once per changed input while focus and text remain. Escape and
 * click-away closes stay closed (flag + focus check).
 */
function KeepSuggestionsOpen({ enabled, controlledSelectedKey, containerRef, escapeClosedAtRef }: {
  enabled: boolean;
  controlledSelectedKey: string | number | null;
  containerRef: RefObject<HTMLDivElement | null>;
  escapeClosedAtRef: RefObject<number>;
}) {
  const state = useContext(ComboBoxStateContext);
  const wasOpen = useRef(false);
  const reopenedForInput = useRef<string | null>(null);
  useEffect(() => {
    if (!state || !enabled) return;
    if (state.isOpen) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const input = containerRef.current?.querySelector("input");
    const text = input?.value.trim() ?? "";
    const inputFocused = document.activeElement != null
      && (document.activeElement as HTMLElement).tagName === "INPUT";
    if (!inputFocused || !text) {
        // Clearing the field invalidates the per-text loop guard: a retype of
        // the same text must reopen suggestions again (FE review line).
        reopenedForInput.current = null;
        return;
    }
    // Escape can fire more than one close render; suppress reopens briefly
    // after any Escape so a dismissed menu stays dismissed.
    if (Date.now() - escapeClosedAtRef.current < 250) return;
    // A real user pick sets BOTH the internal key and the controlled prop.
    if (state.selectedKey != null && String(state.selectedKey) === String(controlledSelectedKey ?? "")) return;
    if (reopenedForInput.current === text) return;
    reopenedForInput.current = text;
    state.setOpen(true);
  });
  return null;
}

export const ComboBox = ({
    placeholder = "Search",
    shortcut = false,
    size = "md",
    children,
    items,
    shortcutClassName,
    icon,
    openOnPress = false,
    hideRequiredIndicator,
    triggerClassName,
    onClear,
    onEnterCommit,
    className,
    popoverPlacement,
    ...otherProps
}: ComboBoxProps) => {
    const placeholderRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [popoverWidth, setPopoverWidth] = useState("");
    const escapeClosedAtRef = useRef(0);

    // Resize observer for popover width
    const onResize = useCallback(() => {
        if (!placeholderRef.current) return;

        const divRect = placeholderRef.current?.getBoundingClientRect();

        setPopoverWidth(divRect.width + "px");
    }, [placeholderRef, setPopoverWidth]);

    useResizeObserver({
        ref: placeholderRef,
        box: "border-box",
        onResize,
    });

    return (
        <SelectContext.Provider value={{ size }}>
            <AriaComboBox
                menuTrigger="focus"
                defaultFilter={matchesComboboxSearch}
                allowsEmptyCollection
                {...otherProps}
                selectedKey={otherProps.selectedKey}
            >
                {(state) => (
                    <div
                        data-input-size={size}
                        className={cx(
                            "flex flex-col gap-1.5",
                            // `state` here is the children render-prop's shape (adds `defaultChildren`);
                            // `className` expects the sibling className render-prop's shape (adds
                            // `defaultClassName`). Both extend the same `ComboBoxRenderProps` and neither
                            // extra field is read by any caller, so the cast is safe.
                            typeof className === "function" ? className(state as unknown as Parameters<typeof className>[0]) : className,
                        )}
                    >
                        {otherProps.label && (
                            <Label isRequired={hideRequiredIndicator ? false : state.isRequired} tooltip={otherProps.tooltip}>
                                {otherProps.label}
                            </Label>
                        )}

                        <KeepSuggestionsOpen
                            enabled={Boolean(otherProps.allowsCustomValue)}
                            controlledSelectedKey={otherProps.selectedKey ?? null}
                            containerRef={containerRef}
                            escapeClosedAtRef={escapeClosedAtRef}
                        />
                        <ComboBoxValue
                            containerRef={containerRef}
                            onEscapeClose={() => { escapeClosedAtRef.current = Date.now(); }}
                            ref={placeholderRef}
                            placeholder={placeholder}
                            shortcut={shortcut}
                            shortcutClassName={shortcutClassName}
                            icon={icon}
                            openOnPress={openOnPress}
                            allowsCustomValue={otherProps.allowsCustomValue}
                            triggerClassName={triggerClassName}
                            onClear={onClear}
                            onEnterCommit={onEnterCommit}
                            size={size}
                            // This is a workaround to correctly calculating the trigger width
                            // while using ResizeObserver wasn't 100% reliable.
                            onFocus={onResize}
                            onPointerEnter={onResize}
                        />

                        <Popover size={size} triggerRef={placeholderRef} style={{ width: popoverWidth }} className={otherProps.popoverClassName} placement={popoverPlacement}>
                            <AriaListBox
                                items={items}
                                className="size-full outline-hidden"
                                renderEmptyState={() => (
                                    <div role="status" className="px-3 py-2 text-xs text-tertiary">
                                        Không tìm thấy kết quả
                                    </div>
                                )}
                            >
                                {children}
                            </AriaListBox>
                        </Popover>

                        {otherProps.hint && (
                            <HintText isInvalid={state.isInvalid} className={cx(size === "sm" && "text-xs")}>
                                {otherProps.hint}
                            </HintText>
                        )}
                    </div>
                )}
            </AriaComboBox>
        </SelectContext.Provider>
    );
};
