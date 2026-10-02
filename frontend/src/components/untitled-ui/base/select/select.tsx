
import type { FC, ReactNode, RefAttributes } from "react";
import { isValidElement, useRef } from "react";
import { ChevronDown } from "@untitledui/icons";
import type { SelectProps as AriaSelectProps } from "react-aria-components";
import { Button as AriaButton, ListBox as AriaListBox, Select as AriaSelect, SelectValue as AriaSelectValue } from "react-aria-components";
import { Avatar } from "@/components/untitled-ui/base/avatar/avatar";
import { HintText } from "@/components/untitled-ui/base/input/hint-text";
import { Label } from "@/components/untitled-ui/base/input/label";
import { cx } from "@/utils/cx";
import { isReactComponent } from "@/utils/is-react-component";
import { ComboBox } from "./combobox";
import { Popover } from "./popover";
import { SelectItem } from "./select-item";
import { type CommonProps, SelectContext, type SelectItemType, sizes } from "./select-shared";

export { SelectContext, sizes, type CommonProps, type SelectItemType } from "./select-shared";

export interface SelectProps extends Omit<AriaSelectProps<SelectItemType>, "children" | "items">, RefAttributes<HTMLDivElement>, CommonProps {
    items?: SelectItemType[];
    popoverClassName?: string;
    /** Extra classes for the trigger button — the element that actually renders the visible boundary. */
    triggerClassName?: string;
    icon?: FC | ReactNode;
    children: ReactNode | ((item: SelectItemType) => ReactNode);
}

interface SelectValueProps {
    isOpen: boolean;
    size: "sm" | "md" | "lg";
    isFocused: boolean;
    isDisabled: boolean;
    isInvalid?: boolean;
    placeholder?: string;
    icon?: FC | ReactNode;
    triggerClassName?: string;
}

const SelectValue = ({ isOpen, isFocused, isDisabled, isInvalid, size, placeholder, icon, triggerClassName }: SelectValueProps) => {
    return (
        <AriaButton
            data-uui-control="select"
            data-control-size={size}
            className={cx(
                "relative flex w-full cursor-pointer items-center rounded-lg border border-primary bg-primary transition duration-100 ease-linear",
                // Error wins over focus: a focused invalid control outlines red;
                // the brand-green focus ring never co-renders with errors.
                isInvalid && (isFocused || isOpen)
                    ? "border-error outline-2 outline-offset-1 outline-error"
                    : cx(
                          "outline-focus-ring",
                          (isFocused || isOpen) && "border-brand outline-2 outline-offset-1",
                      ),
                isDisabled && "cursor-not-allowed opacity-50",
                triggerClassName,
            )}
        >
            <AriaSelectValue<SelectItemType>
                data-uui-select-value
                className={(state) =>
                    cx(
                        "flex h-max w-full items-center justify-start truncate text-left align-middle",

                        sizes[size].root,

                        // With icon
                        (state.selectedItems[0]?.icon || icon) && sizes[size].withIcon,

                        // Icon styles
                        "*:data-icon:shrink-0 *:data-icon:text-fg-quaternary",
                    )
                }
            >
                {(state) => {
                    const selectedItem = state.selectedItems[0];
                    const Icon = selectedItem?.icon || icon;

                    return (
                        <>
                            {selectedItem?.avatarUrl ? (
                                <Avatar size="xs" src={selectedItem.avatarUrl} alt={selectedItem.label} className={cx(size === "sm" && "size-5")} />
                            ) : isReactComponent(Icon) ? (
                                <Icon data-icon aria-hidden="true" />
                            ) : isValidElement(Icon) ? (
                                Icon
                            ) : null}

                            {selectedItem ? (
                                <section className={cx("flex w-full truncate", sizes[size].textContainer)}>
                                    <p className={cx("truncate font-medium text-primary", sizes[size].text)}>{selectedItem?.label}</p>
                                    {selectedItem?.supportingText && <p className={cx("text-tertiary", sizes[size].text)}>{selectedItem?.supportingText}</p>}
                                </section>
                            ) : (
                                <p className={cx("text-placeholder", sizes[size].text)}>{placeholder}</p>
                            )}

                            <ChevronDown
                                aria-hidden="true"
                                className={cx("ml-auto shrink-0 text-fg-quaternary", size === "lg" ? "size-5" : "size-4 stroke-[2.25px]")}
                            />
                        </>
                    );
                }}
            </AriaSelectValue>
        </AriaButton>
    );
};

const Select = ({ placeholder = "Select", icon, size = "md", children, items, label, hint, tooltip, hideRequiredIndicator, className, ...rest }: SelectProps) => {
    const triggerRef = useRef<HTMLDivElement>(null);

    return (
        <SelectContext.Provider value={{ size }}>
            <AriaSelect ref={triggerRef} {...rest} className={(state) => cx("flex flex-col gap-1.5", typeof className === "function" ? className(state) : className)}>
                {(state) => (
                    <>
                        {label && (
                            <Label isRequired={hideRequiredIndicator ? false : state.isRequired} tooltip={tooltip}>
                                {label}
                            </Label>
                        )}

                        {/* isInvalid threaded explicitly: the render-prop state
                            spread is not guaranteed to carry it. */}
                        <SelectValue {...state} isInvalid={rest.isInvalid} {...{ size, placeholder }} icon={icon} triggerClassName={rest.triggerClassName} />

                        <Popover size={size} triggerRef={triggerRef} className={rest.popoverClassName}>
                            <AriaListBox items={items} className="size-full outline-hidden">
                                {children}
                            </AriaListBox>
                        </Popover>

                        {hint && (
                            <HintText isInvalid={state.isInvalid} className={cx(size === "sm" && "text-xs")}>
                                {hint}
                            </HintText>
                        )}
                    </>
                )}
            </AriaSelect>
        </SelectContext.Provider>
    );
};

const _Select = Select as typeof Select & {
    ComboBox: typeof ComboBox;
    Item: typeof SelectItem;
};
_Select.ComboBox = ComboBox;
_Select.Item = SelectItem;

export { _Select as Select };
