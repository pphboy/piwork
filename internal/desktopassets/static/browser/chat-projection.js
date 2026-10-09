export function memoryResultSummary(result, toolName) {
    if (!['brain_experience', 'brain_feedback', 'package:piwork-brain:brain_experience', 'package:piwork-brain:brain_feedback'].includes(toolName ?? '') || result?.kind !== 'text')
        return;
    if (result.isError)
        return 'Memory: operation failed; no effective update confirmed.';
    try {
        const value = JSON.parse(result.text), version = (n) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
        if (value.memoryCommit?.status === 'effective' && version(value.memoryCommit.version))
            return `Memory: effective v${value.memoryCommit.version}.`;
        if (value.status === 'staged' && version(value.version))
            return `Memory: candidate v${value.version} proposed; not effective.`;
        if (value.status === 'invalidated' && version(value.version))
            return `Memory: entry invalidated at v${value.version}.`;
        if (version(value.adoptedExperienceVersion) && version(value.effectiveVersion))
            return `Memory: this Run uses v${value.adoptedExperienceVersion}; current effective v${value.effectiveVersion}.`;
        if (version(value.version) && Array.isArray(value.items))
            return `Memory: ${value.items.length ? 'matching entries' : 'no matching entries'} at v${value.version}${value.truncated ? ' (limited)' : ''}.`;
    }
    catch { /* Unknown or truncated results remain the actual bounded preview. */ }
}
export function resultText(result, toolName) {
    const summary = memoryResultSummary(result, toolName);
    return result?.kind === 'text' ? `${summary ? `${summary}\n` : ''}${result.text}${result.truncated ? '\n[Preview limited to 64 KiB]' : ''}` : result?.kind === 'non-text' ? 'Non-text result. See the saved SDK history for the original.' : 'Result not confirmed.';
}
export function upsertTool(messages, incoming) {
    const existing = incoming.runId && incoming.tool?.id ? messages.find(message => message.runId === incoming.runId && message.tool?.id === incoming.tool?.id) : undefined;
    if (!existing) {
        messages.push(incoming);
        return;
    }
    if (existing.tool?.status === 'Completed' || existing.tool?.status === 'Failed')
        return;
    existing.tool = incoming.tool;
}
export function historyMessages(raw, previous = []) {
    const messages = [];
    for (const message of raw) {
        if (!['user', 'assistant', 'toolResult'].includes(message.role))
            continue;
        if (!message.blocks?.length) {
            messages.push(message.role === 'toolResult' ? { id: message.entryId, role: 'assistant', text: '', tool: { name: 'Tool result', status: 'Unconfirmed', content: resultText(undefined) } } : { id: message.entryId, role: message.role, text: message.text ?? '' });
            continue;
        }
        for (const block of message.blocks) {
            if (block.type === 'text')
                messages.push({ id: block.blockId, runId: message.runId || undefined, role: message.role, text: block.text });
            else
                upsertTool(messages, { id: message.runId ? `${message.runId}-tool-${block.toolCallId}` : block.blockId, runId: message.runId || undefined, role: 'assistant', text: '', tool: { id: block.toolCallId, name: block.toolName, status: block.type === 'tool-call' ? 'Result not confirmed' : block.result?.isError ? 'Failed' : 'Completed', isError: block.result?.isError, content: resultText(block.result, block.toolName) } });
        }
    }
    const remaining = [...previous];
    for (const message of messages) {
        if (!message.runId || message.tool || !message.text)
            continue;
        const index = remaining.findIndex(old => !old.tool && old.runId === message.runId && old.role === message.role && old.text === message.text);
        if (index !== -1) {
            message.id = remaining[index]?.id ?? message.id;
            remaining.splice(index, 1);
        }
    }
    return messages;
}
export function activityGroups(messages) {
    const groups = [];
    messages.forEach((message, index) => {
        if (!message.text && !message.tool)
            return;
        const last = groups.at(-1);
        if (message.tool && message.runId && last?.activity && last.messages[0]?.runId === message.runId)
            last.messages.push(message);
        else
            groups.push({ key: message.id ?? `${message.runId || 'legacy'}-${index}`, messages: [message], activity: !!message.tool });
    });
    return groups;
}
//# sourceMappingURL=chat-projection.js.map