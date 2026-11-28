import { fieldLabelText } from "../control-typography";
import type { ReactNode, Ref } from "react";
import { HelpCircle } from "@untitledui/icons";
import type { LabelProps as AriaLabelProps } from "react-aria-components";
import { Label as AriaLabel } from "react-aria-components";
import { Tooltip, TooltipTrigger } from "@/components/untitled-ui/base/tooltip/tooltip";
import { cx } from "@/utils/cx";

interface LabelProps extends AriaLabelProps {
    children: ReactNode;
    isInvalid?: boolean;
    isRequired?: boolean;
    tooltip?: string;
    tooltipDescription?: string;
    ref?: Ref<HTMLLabelElement>;
}

export const Label = ({ isInvalid: _isInvalid, isRequired, tooltip, tooltipDescription, className, ...props }: LabelProps) => {
    return (
        <AriaLabel
            // Used for conditionally hiding/showing the label element via CSS:
            // <Input label="Visible only on mobile" className="lg:**:data-label:hidden" />
            // or
            // <Input label="Visible only on mobile" className="lg:label:hidden" />
            data-label="true"
            {...props}
            className={cx("flex cursor-default items-center gap-0.5 text-secondary", fieldLabelText, className)}
        >
            {props.children}

            {isRequired && (
                // House law (CR-011.2 DoD-01 "9 red *"): a required mark uses
                // the SAME token as the sheet's .csc-req marks —
                // var(--fg-error, #d92d20) — never the stock Untitled UI
                // brand accent. SIL-1283: the mark is always " *" — its
                // separating space is real text (the flex gap is not text),
                // so every required label reads "Tên trường *" like the
                // hand-built "Số tiền *" labels. Callers therefore never
                // carry their own star in the label string when `required`.
                <span aria-hidden="true" style={{ color: 'var(--fg-error, #d92d20)' }}>{" *"}</span>
            )}

            {tooltip && (
                <Tooltip title={tooltip} description={tooltipDescription} placement="top">
                    <TooltipTrigger
                        // `TooltipTrigger` inherits the disabled state from the parent form field
                        // but we don't that. We want the tooltip be enabled even if the parent
                        // field is disabled.
                        isDisabled={false}
                        className="cursor-pointer text-fg-quaternary transition duration-200 hover:text-fg-quaternary_hover focus:text-fg-quaternary_hover"
                    >
                        <HelpCircle className="size-4" />
                    </TooltipTrigger>
                </Tooltip>
            )}
        </AriaLabel>
    );
};

Label.displayName = "Label";
