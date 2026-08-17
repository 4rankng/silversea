import { type SelectHTMLAttributes, useId } from "react";
import { ChevronDown } from "@untitledui/icons";
import { HintText } from "@/components/untitled-ui/base/input/hint-text";
import { Label } from "@/components/untitled-ui/base/input/label";
import { cx } from "@/utils/cx";

interface NativeSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
    label?: string;
    hideLabel?: boolean;
    hint?: string;
    selectClassName?: string;
    size?: "sm" | "md" | "lg";
    options: { label: string; value: string; disabled?: boolean }[];
}

const styles = {
    sm: {
        // Always reserve the trailing icon lane. Without it, a long selected
        // label can paint underneath the chevron and hide the select affordance.
        root: "min-h-[34px] py-1 pl-2.5 pr-8 text-xs max-md:min-h-11 max-md:py-2 max-md:pl-3 max-md:pr-10 max-md:text-sm",
        icon: "size-4 right-2.5 stroke-[2.25px]",
    },
    md: {
        root: "py-2 pl-3 pr-10 text-md",
        icon: "size-4 stroke-[2.25px] right-3",
    },
    lg: {
        root: "py-2.5 pl-3.5 pr-11 text-md",
        icon: "size-5 right-3",
    },
};

export const NativeSelect = ({ label, hideLabel, hint, options, className, selectClassName, size = "md", ...props }: NativeSelectProps) => {
    const id = useId();
    const selectId = `select-native-${id}`;
    const labelId = `select-native-label-${id}`;
    const hintId = `select-native-hint-${id}`;

    return (
        <div data-input-size={size} className={cx("w-full in-data-input-wrapper:w-max", className)}>
            {label && (
                <Label htmlFor={selectId} id={labelId} className={cx(size === "sm" ? "mb-1" : "mb-1.5", hideLabel && "sr-only")}>
                    {label}
                </Label>
            )}

            <div className="relative grid w-full items-center">
                <select
                    {...props}
                    id={selectId}
                    aria-describedby={hint ? hintId : undefined}
                    aria-labelledby={label ? labelId : undefined}
                    className={cx(
                        "w-full min-w-0 max-w-full appearance-none rounded-lg border border-primary bg-primary font-medium text-primary outline-focus-ring transition duration-100 ease-linear placeholder:text-fg-quaternary focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-50",

                        styles[size].root,

                        // Styles when the select is within an `InputGroup`
                        "in-data-input-wrapper:flex in-data-input-wrapper:h-full in-data-input-wrapper:gap-1 in-data-input-wrapper:border-0 in-data-input-wrapper:bg-inherit in-data-input-wrapper:px-3 in-data-input-wrapper:py-2 in-data-input-wrapper:font-normal in-data-input-wrapper:text-tertiary in-data-input-wrapper:shadow-none in-data-input-wrapper:ring-transparent in-data-input-wrapper:in-data-[size=sm]:text-sm",
                        // Styles for the select when `TextField` is disabled
                        "in-data-input-wrapper:group-disabled:pointer-events-none in-data-input-wrapper:group-disabled:cursor-not-allowed in-data-input-wrapper:group-disabled:bg-transparent",
                        // Common styles for sizes and border radius within `InputGroup`
                        "in-data-input-wrapper:in-data-leading:rounded-r-none in-data-input-wrapper:in-data-trailing:rounded-l-none in-data-input-wrapper:in-data-[input-size=lg]:py-2.5 in-data-input-wrapper:in-data-[input-size=md]:py-2 in-data-input-wrapper:in-data-[input-size=md]:pl-3 in-data-input-wrapper:in-data-[input-size=sm]:text-sm",
                        // For "leading" dropdown within `InputGroup`
                        "in-data-input-wrapper:in-data-leading:pr-4.5 in-data-input-wrapper:in-data-leading:in-data-[input-size=lg]:pl-3.5 in-data-input-wrapper:in-data-leading:in-data-[input-size=md]:pr-4.5 in-data-input-wrapper:in-data-leading:in-data-[input-size=md]:pl-3 in-data-input-wrapper:in-data-leading:in-data-[input-size=sm]:pr-3.5",
                        // For "trailing" dropdown within `InputGroup`
                        "in-data-input-wrapper:in-data-trailing:in-data-[input-size=lg]:pr-8 in-data-input-wrapper:in-data-trailing:in-data-[input-size=md]:pr-7.5 in-data-input-wrapper:in-data-trailing:in-data-[input-size=sm]:pr-6.5",
                        selectClassName,
                    )}
                >
                    {options.map((opt) => (
                        <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                            {opt.label}
                        </option>
                    ))}
                </select>

                <ChevronDown
                    aria-hidden="true"
                    className={cx(
                        "pointer-events-none absolute text-fg-quaternary",

                        styles[size].icon,
                        // Styles for the icon when the select is within an `InputGroup`
                        "in-data-input-wrapper:right-0 in-data-input-wrapper:size-4 in-data-input-wrapper:stroke-[2.625px]",
                        // For "trailing" dropdown within `InputGroup`
                        "in-data-input-wrapper:in-data-trailing:in-data-[input-size=md]:right-3 in-data-input-wrapper:in-data-trailing:in-data-[input-size=sm]:right-3",
                    )}
                />
            </div>

            {hint && (
                <HintText className="mt-2" id={hintId}>
                    {hint}
                </HintText>
            )}
        </div>
    );
};
