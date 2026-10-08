/** House tel: pattern (card 20261005_364, sweep card 081026230540): the
 * number itself is the tap-to-call control. The URI strips ALL whitespace so
 * the webview dialer accepts it; the visible number keeps its digits. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/\s+/g, '')}`;
}

export function TelLink({ phone, className, 'aria-label': ariaLabel }: {
  phone: string;
  className?: string;
  'aria-label'?: string;
}) {
  return <a href={telHref(phone)} className={className} {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}>{phone}</a>;
}
