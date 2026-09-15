/** Reveal an active option without scrollIntoView moving page ancestors. */
export function scrollActiveOption(option: HTMLElement | null | undefined): void {
  const list = option?.closest<HTMLElement>('[role="listbox"]');
  if (!option || !list) return;
  const optionBox = option.getBoundingClientRect();
  const listBox = list.getBoundingClientRect();
  const top = listBox.top + list.clientTop;
  const bottom = top + list.clientHeight;
  if (optionBox.top < top) list.scrollTop += optionBox.top - top;
  else if (optionBox.bottom > bottom) list.scrollTop += optionBox.bottom - bottom;
}
