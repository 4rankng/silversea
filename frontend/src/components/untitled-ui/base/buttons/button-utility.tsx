import type { FC, ReactNode } from "react";
import { isValidElement } from "react";
import type { Placement } from "react-aria";
import type { ButtonProps as AriaButtonProps } from "react-aria-components";
import { Button as AriaButton } from "react-aria-components";
import { Tooltip } from "@/components/untitled-ui/base/tooltip/tooltip";
import { cx } from "@/utils/cx";
import { isReactComponent } from "@/utils/is-react-component";

export const styles = {
    secondary:
        "bg-primary text-fg-quaternary shadow-xs-skeuomorphic ring-1 ring-primary ring-inset hover:bg-primary_hover hover:text-fg-quaternary_hover disabled:shadow-xs",
    tertiary: "text-fg-quaternary hover:bg-primary_hover hover:text-fg-quaternary_hover",
};

export interface ButtonUtilityProps extends Omit<AriaButtonProps, "children" | "className"> {
    isDisabled?: boolean;
    size?: "xs" | "sm";
    color?: "secondary" | "tertiary";
    icon?: FC<{ className?: string }> | ReactNode;
    tooltip?: string;
    tooltipPlacement?: Placement;
    className?: string;
}

export const ButtonUtility = ({
    tooltip,
    className,
    isDisabled,
    icon: Icon,
    size = "sm",
    color = "secondary",
    tooltipPlacement = "top",
    ...otherProps
}: ButtonUtilityProps) => {
    const utilityClassName = cx(
        "group relative inline-flex h-max cursor-pointer items-center justify-center rounded-md p-1.5 outline-focus-ring transition duration-100 ease-linear focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        styles[color],
        "*:data-icon:pointer-events-none *:data-icon:shrink-0 *:data-icon:text-current *:data-icon:transition-inherit-all",
        size === "xs" ? "*:data-icon:size-4" : "*:data-icon:size-5",
        className,
    );
    const icon = (
        <>
            {isReactComponent(Icon) && <Icon data-icon />}
            {isValidElement(Icon) && Icon}
        </>
    );
    const content = (
        <AriaButton
            {...otherProps}
            type={otherProps.type || "button"}
            isDisabled={isDisabled}
            aria-label={tooltip}
            className={utilityClassName}
        >
            {icon}
        </AriaButton>
    );

    if (!tooltip) return content;

    return (
        <Tooltip title={tooltip} placement={tooltipPlacement} isDisabled={isDisabled} offset={size === "xs" ? 4 : 6}>
            {content}
        </Tooltip>
    );
};
