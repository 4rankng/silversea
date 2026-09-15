import { Children, Fragment, cloneElement, isValidElement, type AriaAttributes, type ReactNode } from 'react';

type ChildProps = Pick<AriaAttributes, 'aria-describedby' | 'aria-invalid'> & {
  id?: string; type?: string; children?: ReactNode;
  value?: unknown; defaultValue?: unknown; onChange?: unknown; onValueChange?: unknown;
};
const LABELABLE = new Set(['input', 'select', 'textarea', 'button', 'meter', 'output', 'progress']);

/** Associate one field, leaving decorative icons and sibling descriptions intact. */
export function bindFormGroupControl(children: ReactNode, generatedId: string, htmlFor?: string, feedback?: { descriptionId?: string; invalid?: boolean }) {
  function find(nodes: ReactNode, allowOpaque: boolean): ReactNode {
    for (const node of Children.toArray(nodes)) {
      if (!isValidElement<ChildProps>(node) || (node.type === 'input' && node.props.type === 'hidden')) continue;
      if (htmlFor) {
        if (node.props.id === htmlFor) return node;
        const nested = find(node.props.children, allowOpaque);
        if (nested) return nested;
        continue;
      }
      const custom = typeof node.type !== 'string' && node.type !== Fragment;
      const declaredField = 'value' in node.props || 'defaultValue' in node.props
        || typeof node.props.onChange === 'function' || typeof node.props.onValueChange === 'function';
      if ((typeof node.type === 'string' && LABELABLE.has(node.type)) || (custom && (declaredField || allowOpaque))) return node;
      const nested = find(node.props.children, allowOpaque);
      if (nested) return nested;
    }
    return null;
  }
  // Native inputs and declared custom fields take precedence over opaque icons.
  // A standalone custom field can still forward the generated id without value props.
  const target = find(children, false) || find(children, true);
  const fieldId = htmlFor || (isValidElement<ChildProps>(target) ? target.props.id || generatedId : generatedId);
  function bind(nodes: ReactNode): ReactNode {
    return Children.map(nodes, node => {
      if (!isValidElement<ChildProps>(node)) return node;
      // Children.toArray clones keyed elements, so match the selected field's props/type.
      if (isValidElement<ChildProps>(target) && node.type === target.type && node.props === target.props) {
        const description = [...new Set([node.props['aria-describedby'], feedback?.descriptionId].filter(Boolean).join(' ').split(/\s+/).filter(Boolean))].join(' ');
        return cloneElement(node, {
          id: fieldId,
          ...(description ? { 'aria-describedby': description } : {}),
          ...(feedback?.invalid ? { 'aria-invalid': true } : {}),
        });
      }
      return node.props.children ? cloneElement(node, { children: bind(node.props.children) }) : node;
    });
  }
  return { children: bind(children), fieldId };
}
