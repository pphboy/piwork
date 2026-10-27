/** Normalize only the operation kinds understood by the Desktop control flows. */
export function operationKind(kind: string): string {
  const value = kind.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const work = /^(create|start|stop|retry|delete) work$/.exec(value);
  if (work) return `work:${work[1]}`;
  if (value === 'work action') return 'work:*';
  const service = /^(start|stop|enable|disable|restart|retry|remove|create|update|cleanup temporary|create temporary) service$/.exec(value);
  if (service) return `service:${({ start: 'enable', stop: 'disable' } as Record<string, string>)[service[1]] || service[1]}`;
  if (value === 'service action') return 'service:*';
  if (value === 'apply configuration' || value === 'apply work configuration') return 'apply:configuration';
  if (value === 'import work') return 'transfer:import';
  if (value === 'export work') return 'transfer:export';
  if (value === 'pi package action') return 'package:*';
  const pkg = /^(?:pi package (install|update|remove)|(install|update|remove) pi package)$/.exec(value);
  if (pkg) return `package:${pkg[1] || pkg[2]}`;
  return '';
}

/** A generic saved category may match a specific server kind, never another category. */
export function operationKindMatches(expected: string, actual: string): boolean {
  const left = operationKind(expected), right = operationKind(actual);
  if (!left || !right) return false;
  return left === right || left.endsWith(':*') && left.split(':')[0] === right.split(':')[0];
}
