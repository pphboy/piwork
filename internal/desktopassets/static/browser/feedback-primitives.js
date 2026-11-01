/** Decorative only: the feature supplies the accessible label and busy semantics. */
export const pendingDots = () => '<span class="pending-dots" aria-hidden="true"><i></i><i></i><i></i></span>';

const paths = {
  refresh: '<path d="M20 7v5h-5M20 12a8 8 0 1 1-2.34-5.66"/>',
  'open-work': '<path d="M14 3h6v18h-6M3 12h12m-5-5 5 5-5 5"/>',
};

/** Undefined means this feature owns the icon; shared semantics cannot drift. */
export function sharedIcon(name, size = 18) {
  if (!Object.hasOwn(paths, name)) return undefined;
  const dimension = name === 'refresh' ? 18 : size;
  return `<svg class="icon shared-icon icon-${name}" width="${dimension}" height="${dimension}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
