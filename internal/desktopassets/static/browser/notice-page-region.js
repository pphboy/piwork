/** Feature-local DOM wiring only. Shared notices owns visibility, clipping and placement. */
export function desktopNoticePageRegion(root) {
    const header = root.querySelector('.work-header, .topbar-works');
    const toolbars = [...root.querySelectorAll([
            '#workspace-main > .files-toolbar',
            '#workspace-main > .service-toolbar',
            '.settings-page > .settings-navigation',
            '.settings-page > .settings-heading',
            '.settings-page > .configuration-state',
            '.settings-page > .settings-tabs',
            '.agent-panel > .agent-header',
            '#workspace-main > .file-target-toolbar',
            '.settings-page > .settings-back',
            '.settings-page > .feedback [data-action="refresh-config"]',
        ].join(', '))];
    const footers = [...root.querySelectorAll([
            '#workspace-main > .editor-footer',
            '.settings-page > .settings-savebar',
            '.composer-wrap',
        ].join(', '))];
    return header || toolbars.length || footers.length ? { header, toolbars, footers } : null;
}
//# sourceMappingURL=notice-page-region.js.map