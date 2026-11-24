/** Only the original submitted scope is evidence for its unknown result.
 * A matching name array alone cannot confirm a Skill text write. */
export function settingsPatchMatchesRead(patch, read) {
    if (patch.addSkills?.some(name => !read.desired.skills.includes(name)))
        return false;
    if (patch.removeSkills?.some(name => read.desired.skills.includes(name)))
        return false;
    if (patch.agentsMd !== undefined && patch.agentsMd !== read.desired.agentsMd)
        return false;
    if (patch.packageFlags?.some(flag => read.desired.packages.find(item => item.name === flag.name)?.enabled !== flag.enabled))
        return false;
    return !(patch.skillFiles ?? []).some(file => !read.files.some(saved => saved.skillName === file.skillName && saved.path === file.path && saved.text === file.text));
}
export function createSettingsDraft(facts, source = 'Saved Work copy') {
    return {
        fieldBaseline: structuredClone(facts),
        skills: [...facts.skills],
        packages: facts.packages.map((item) => ({ ...item, source })),
        agents: facts.agentsMd,
        files: {},
        baselines: {},
        fileInfo: {},
    };
}
export function applySettingsRead(draft, skillName, files, texts) {
    const next = structuredClone(draft);
    next.fileInfo[skillName] = files.map((file) => ({ ...file }));
    next.files[skillName] = { ...texts };
    next.baselines[skillName] = { ...texts };
    return next;
}
export function editSettingsFile(draft, skillName, path, text) {
    const next = structuredClone(draft);
    next.files[skillName] = { ...(next.files[skillName] ?? {}), [path]: text };
    return next;
}
/** Cache keys are valid Skill names and relative file paths, including names
 * such as constructor and __proto__. Only own entries are loaded facts. */
export function settingsListedFiles(draft, skillName) {
    return Object.hasOwn(draft.fileInfo, skillName) ? draft.fileInfo[skillName] : undefined;
}
export function settingsLoadedText(draft, skillName, path, baseline = false) {
    const source = baseline ? draft.baselines : draft.files;
    const files = Object.hasOwn(source, skillName) ? source[skillName] : undefined;
    return files && Object.hasOwn(files, path) ? files[path] : undefined;
}
export function settingsFileDirty(draft, skillName, path) {
    return (settingsLoadedText(draft, skillName, path) ?? '') !== (settingsLoadedText(draft, skillName, path, true) ?? '');
}
export function settingsSkillDirty(draft, skillName) {
    return Object.keys(draft.files[skillName] ?? {}).some((path) => settingsFileDirty(draft, skillName, path));
}
export function settingsDraftDirty(draft, baseline) {
    baseline = draft.fieldBaseline ?? baseline;
    if (draft.agents !== baseline.agentsMd)
        return true;
    if (draft.skills.length !== baseline.skills.length || draft.skills.some((name, index) => name !== baseline.skills[index]))
        return true;
    const saved = new Map(baseline.packages.map((item) => [item.name, item.enabled]));
    if (draft.packages.length !== baseline.packages.length)
        return true;
    if (draft.packages.some((item) => saved.get(item.name) !== item.enabled))
        return true;
    return draft.skills.some((skill) => settingsSkillDirty(draft, skill));
}
export function buildSettingsPatch(draft, baseline) {
    baseline = draft.fieldBaseline ?? baseline;
    const patch = {};
    const saved = new Set(baseline.skills);
    const current = new Set(draft.skills);
    const addSkills = draft.skills.filter((name) => !saved.has(name));
    const removeSkills = baseline.skills.filter((name) => !current.has(name));
    if (addSkills.length)
        patch.addSkills = addSkills;
    if (removeSkills.length)
        patch.removeSkills = removeSkills;
    const skillFiles = [];
    for (const [skillName, files] of Object.entries(draft.files)) {
        for (const [path, text] of Object.entries(files)) {
            if (text !== (settingsLoadedText(draft, skillName, path, true) ?? null) && current.has(skillName)) {
                skillFiles.push({ skillName, path, text });
            }
        }
    }
    if (skillFiles.length)
        patch.skillFiles = skillFiles;
    if (draft.agents !== baseline.agentsMd)
        patch.agentsMd = draft.agents;
    const packageFlags = draft.packages
        .filter((item) => baseline.packages.find((savedItem) => savedItem.name === item.name)?.enabled !== item.enabled)
        .map((item) => ({ name: item.name, enabled: item.enabled }));
    if (packageFlags.length)
        patch.packageFlags = packageFlags;
    return patch;
}
export function settingsPatchEmpty(patch) {
    return !patch.addSkills?.length && !patch.removeSkills?.length && !patch.skillFiles?.length &&
        patch.agentsMd === undefined && !patch.packageFlags?.length;
}
/** Confirms only the captured file targets. The adapter updates the saved
 * skill/package/AGENTS baseline, so a late response never overwrites edits
 * made after the request was submitted. */
export function confirmSettingsPatch(draft, patch) {
    const next = structuredClone(draft);
    if (next.fieldBaseline) {
        const baseline = next.fieldBaseline;
        baseline.skills = baseline.skills.filter(name => !patch.removeSkills?.includes(name));
        for (const name of patch.addSkills ?? [])
            if (!baseline.skills.includes(name))
                baseline.skills.push(name);
        if (patch.agentsMd !== undefined)
            baseline.agentsMd = patch.agentsMd;
        for (const flag of patch.packageFlags ?? []) {
            const item = baseline.packages.find(item => item.name === flag.name);
            if (item)
                item.enabled = flag.enabled;
            else
                baseline.packages.push({ ...flag });
        }
    }
    for (const file of patch.skillFiles ?? []) {
        next.baselines[file.skillName] = { ...(next.baselines[file.skillName] ?? {}), [file.path]: file.text };
    }
    return next;
}
/** Refresh untouched form fields without turning a stale value into an edit.
 * Changed groups keep their own baseline until their captured patch confirms. */
export function rebaseSettingsDraft(draft, latest) {
    const next = structuredClone(draft);
    const baseline = draft.fieldBaseline ?? latest;
    next.fieldBaseline = structuredClone(baseline);
    if (draft.agents === baseline.agentsMd) {
        next.agents = latest.agentsMd;
        next.fieldBaseline.agentsMd = latest.agentsMd;
    }
    const sameSkills = draft.skills.length === baseline.skills.length && draft.skills.every((name, index) => name === baseline.skills[index]);
    if (sameSkills && !draft.skills.some(name => settingsSkillDirty(draft, name))) {
        next.skills = [...latest.skills];
        next.fieldBaseline.skills = [...latest.skills];
    }
    const samePackages = draft.packages.length === baseline.packages.length && draft.packages.every(item => baseline.packages.some(saved => saved.name === item.name && saved.enabled === item.enabled));
    if (samePackages) {
        next.packages = latest.packages.map(item => ({ ...item, source: draft.packages.find(old => old.name === item.name)?.source }));
        next.fieldBaseline.packages = latest.packages.map(item => ({ ...item }));
    }
    return next;
}
/** A known rejected save can retire when its edited targets were withdrawn.
 * Other draft targets and unknown writes do not prove that withdrawal. */
export function settingsPatchTargetsWithdrawn(original, current) {
    return !(original.addSkills ?? []).some(name => current.addSkills?.includes(name)) &&
        !(original.removeSkills ?? []).some(name => current.removeSkills?.includes(name)) &&
        !(original.skillFiles ?? []).some(file => current.skillFiles?.some(target => target.skillName === file.skillName && target.path === file.path)) &&
        (original.agentsMd === undefined || current.agentsMd === undefined) &&
        !(original.packageFlags ?? []).some(flag => current.packageFlags?.some(target => target.name === flag.name));
}
/** Browser preflight for the existing editor contract limits. Core repeats
 * these checks; parity cases use WORK_SETTINGS_LIMITS from contracts. */
export function settingsPatchBudgetProblem(patch) {
    const bytes = (value) => new TextEncoder().encode(value).byteLength;
    if (patch.skillFiles?.some(file => bytes(file.text) > 1024 * 1024))
        return 'file';
    if (patch.agentsMd !== undefined && bytes(patch.agentsMd) > 256 * 1024)
        return 'agents';
    if ((patch.skillFiles?.length ?? 0) > 64 || bytes(JSON.stringify(patch)) > 2 * 1024 * 1024)
        return 'request';
    return undefined;
}
//# sourceMappingURL=settings-draft.js.map