
import type { FC, FocusEventHandler, MouseEventHandler, PointerEventHandler, ReactNode, Ref, RefAttributes } from "react";
import { isValidElement, useCallback, useContext, useRef, useState } from "react";
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
    triggerClassName?: string;
    onClear?: () => void;
    onFocus?: FocusEventHandler;
    onPointerEnter?: PointerEventHandler;
    ref?: Ref<HTMLDivElement>;
}

const ComboBoxValue = ({ size, shortcut, placeholder, shortcutClassName, icon: IconProp, openOnPress, triggerClassName, onClear, ref, ...otherProps }: ComboBoxValueProps) => {
    const state = useContext(ComboBoxStateContext);

    const value = state?.selectedItem?.value || (state?.selectedKey != null ? { id: state.selectedKey } : null);
    const inputValue = state?.inputValue || null;
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
                data-combobox-value
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
                    <SearchLg data-icon className="pointer-events-none" aria-hidden="true" />
                )}

                <div className="relative flex w-full items-center">
                    {inputValue && (
                        <span className={cx("absolute top-1/2 z-0 inline-flex w-full -translate-y-1/2 truncate", sizes[size].textContainer)} aria-hidden="true">
                            <p className={cx("font-medium text-primary", sizes[size].text)}>{first}</p>
                            {last && <p className={cx("-ml-0.75 text-tertiary", sizes[size].text)}>{last}</p>}
                        </span>
                    )}

                    <AriaInput
                        placeholder={placeholder}
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
                            onClear();
                            state?.setSelectedKey(null);
                            state?.setInputValue('');
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
        .trim();
}

/** ListBox that narrows `items` by the combobox's current input text
 *  (diacritic-insensitive). React-aria never filters for us; without this
 *  the option list shows the whole catalog no matter what the user types. */
const FilteredListBox = ({ items, children, ...rest }: AriaListBoxProps<SelectItemType> & { items?: SelectItemType[] }) => {
    const state = useContext(ComboBoxStateContext);
    const query = normalizeSearchText(state?.inputValue ?? "");
    const filtered = query && items
        ? items.filter((item) => normalizeSearchText(
            `${item.label ?? ""} ${(item as { supportingText?: string }).supportingText ?? ""}`,
        ).includes(query))
        : items;
    return <AriaListBox {...rest} items={filtered}>{children}</AriaListBox>;
};

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
    className,
    popoverPlacement,
    ...otherProps
}: ComboBoxProps) => {
    const placeholderRef = useRef<HTMLDivElement>(null);
    const [popoverWidth, setPopoverWidth] = useState("");

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

                        <ComboBoxValue
                            ref={placeholderRef}
                            placeholder={placeholder}
                            shortcut={shortcut}
                            shortcutClassName={shortcutClassName}
                            icon={icon}
                            openOnPress={openOnPress}
                            triggerClassName={triggerClassName}
                            onClear={onClear}
                            size={size}
                            // This is a workaround to correctly calculating the trigger width
                            // while using ResizeObserver wasn't 100% reliable.
                            onFocus={onResize}
                            onPointerEnter={onResize}
                        />

                        <Popover size={size} triggerRef={placeholderRef} style={{ width: popoverWidth }} className={otherProps.popoverClassName} placement={popoverPlacement}>
                            <FilteredListBox items={items} className="size-full outline-hidden">
                                {children}
                            </FilteredListBox>
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
