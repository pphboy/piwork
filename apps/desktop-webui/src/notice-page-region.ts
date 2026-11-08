/** Feature-local DOM wiring only. Shared notices owns visibility, clipping and placement. */
export function desktopNoticePageRegion(root: Pick<ParentNode, 'querySelector' | 'querySelectorAll'>) {
  const header = root.querySelector<HTMLElement>('.work-header, .topbar-works');
  const toolbars = [...root.querySelectorAll<HTMLElement>([
    '#workspace-main > .files-toolbar',
    '#workspace-main > .service-toolbar',
    '.settings-page > .settings-navigation',
    '.settings-page > .settings-heading',
    '.settings-page > .configuration-state',
    '.settings-layout > .settings-tabs',
    '.agent-panel > .agent-header',
    '.messages .message-submission.failed',
    '#workspace-main > .file-target-toolbar',
    '.settings-page > .settings-back',
    '.settings-page > .feedback [data-action="refresh-config"]',
  ].join(', '))];
  const footers = [...root.querySelectorAll<HTMLElement>([
    '#workspace-main > .editor-footer',
    '.settings-page > .settings-savebar',
    '.composer-wrap',
  ].join(', '))];
  return header || toolbars.length || footers.length ? { header, toolbars, footers } : null;
}
