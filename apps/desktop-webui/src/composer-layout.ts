/** Composer presentation only; drafts, submissions and admission stay with their owners. */
export function composerEditorGeometry(scrollHeight: number, viewportHeight: number, expanded: boolean) {
  const maximum = Math.max(150, Math.min(expanded ? 390 : 216, viewportHeight * (expanded ? .46 : .28)));
  const minimum = expanded ? Math.min(180, maximum) : 42;
  return { height: Math.round(Math.max(minimum, Math.min(scrollHeight, maximum))), overflow: scrollHeight > maximum ? 'auto' : 'hidden' };
}

/** A confirmed owner may synchronize only the unchanged editor for its original draft. */
export function composerMatchesConsumedDraft(editor: Readonly<{ draftKey: string; value: string }> | null, draftKey: string, originalText: string): boolean {
  return editor?.draftKey === draftKey && editor.value === originalText;
}
