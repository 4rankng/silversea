import { isValidElement, type ReactNode } from 'react';

/** Read only rendered labels, never hidden identifiers or unrelated record metadata. */
export function configurationText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(configurationText).join(' ');
  if (isValidElement<{ children?: ReactNode }>(node)) return configurationText(node.props.children);
  return '';
}

export function normalizeConfigurationText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();
}
