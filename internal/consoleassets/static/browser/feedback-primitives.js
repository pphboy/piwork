/** Decorative only: the feature supplies the accessible label and busy semantics. */
export const pendingDots = () => '<span class="pending-dots" aria-hidden="true"><i></i><i></i><i></i></span>';

const paths = {
  'admin-overview': '<rect x="3" y="3" width="7" height="10" rx="1.5"/><rect x="14" y="3" width="7" height="6" rx="1.5"/><rect x="3" y="17" width="7" height="4" rx="1.5"/><rect x="14" y="13" width="7" height="8" rx="1.5"/>',
  'admin-users': '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m0-15a3 3 0 0 1 3 5m0 4a5 5 0 0 1 3 5v1"/>',
  'admin-setup': '<path d="M3 6h3m4 0h11M3 12h11m4 0h3M3 18h6m4 0h8"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="11" cy="18" r="2"/>',
  'admin-models': '<path d="m7 6 3.5 4m3 4L17 18m0-12-3.5 4m-3 4L7 18"/><circle cx="12" cy="12" r="3"/><circle cx="5" cy="4" r="2.5"/><circle cx="19" cy="4" r="2.5"/><circle cx="5" cy="20" r="2.5"/><circle cx="19" cy="20" r="2.5"/>',
  refresh: '<path d="M20 7v5h-5M20 12a8 8 0 1 1-2.34-5.66"/>',
  'open-work': '<path d="M14 3h6v18h-6M3 12h12m-5-5 5 5-5 5"/>',
  'nav-services': '<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>',
  'nav-files': '<path d="M3 8.5V6.2A2.2 2.2 0 0 1 5.2 4H9l2.4 3H18.8A2.2 2.2 0 0 1 21 9.2V17.8A2.2 2.2 0 0 1 18.8 20H5.2A2.2 2.2 0 0 1 3 17.8V8.5Z"/><path d="M3.5 9.5H20.5"/>',
  'nav-chat': '<path d="M5.5 4H18.5A2.5 2.5 0 0 1 21 6.5V15A2.5 2.5 0 0 1 18.5 17.5H10L5 21V17.45A2.5 2.5 0 0 1 3 15V6.5A2.5 2.5 0 0 1 5.5 4Z"/><path d="M7 9H17M7 12.5H13.5"/>',
  'composer-attachment': '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  'composer-expand': '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>',
  'composer-collapse': '<path d="M3 8h5V3M16 3v5h5M21 16h-5v5M8 21v-5H3"/>',
};

/** Undefined means this feature owns the icon; shared semantics cannot drift. */
export function sharedIcon(name, size = 18) {
  if (!Object.hasOwn(paths, name)) return undefined;
  const dimension = name === 'refresh' || name.startsWith('nav-') ? 18 : size;
  const stroke = name.startsWith('nav-') || name.startsWith('composer-') || name.startsWith('admin-') ? '1.75' : '1.7';
  return `<svg class="icon shared-icon icon-${name}" width="${dimension}" height="${dimension}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
