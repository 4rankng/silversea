/** Shared type roles for fields and their portalled options. Geometry remains
 * with each primitive; all viewports resolve through the selected product scale. */
export const fieldTextSizes = {
    sm: "text-[length:var(--text-control-compact-size)] leading-[1.35] max-md:text-[length:var(--control-zoom-safe-font-size)] [@media(pointer:coarse)]:text-[length:var(--control-zoom-safe-font-size)]",
    md: "text-[length:var(--text-control-size)] leading-[1.35] max-md:text-[length:var(--control-zoom-safe-font-size)] [@media(pointer:coarse)]:text-[length:var(--control-zoom-safe-font-size)]",
    lg: "text-[length:var(--text-control-size)] leading-[1.35] max-md:text-[length:var(--control-zoom-safe-font-size)] [@media(pointer:coarse)]:text-[length:var(--control-zoom-safe-font-size)]",
} as const;

export const compactActionText = "text-[length:var(--text-control-compact-size)] leading-[1.35] max-md:text-[length:var(--text-control-size)] [@media(pointer:coarse)]:text-[length:var(--text-control-size)]";
export const fieldLabelText = "text-xs leading-[1.5] font-semibold";
export const fieldHintText = "text-xs leading-[1.5]";
