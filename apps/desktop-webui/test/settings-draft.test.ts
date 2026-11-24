import test from 'node:test';
import assert from 'node:assert/strict';

const {
  createSettingsDraft, applySettingsRead, editSettingsFile, settingsDraftDirty, settingsFileDirty,
  settingsSkillDirty, buildSettingsPatch, settingsPatchEmpty, confirmSettingsPatch, settingsPatchMatchesRead, settingsPatchTargetsWithdrawn, settingsPatchBudgetProblem, settingsListedFiles, settingsLoadedText, rebaseSettingsDraft,
} = await import(new URL('../browser/settings-draft.js', import.meta.url).href);

const baseline = {
  skills: ['code-review'],
  packages: [{ name: 'tools', enabled: true }],
  agentsMd: '# Agent',
};

function loaded() {
  const draft = createSettingsDraft(baseline);
  return applySettingsRead(draft, 'code-review', [
    { path: 'SKILL.md', size: 8, editable: true, reason: null },
    { path: 'asset.bin', size: 3, editable: false, reason: 'binary' },
  ], { 'SKILL.md': '# Review' });
}

test('file draft tracks per-file and per-Skill dirtiness without mixing statuses', () => {
  const draft = loaded();
  assert.equal(settingsDraftDirty(draft, baseline), false);
  const edited = editSettingsFile(draft, 'code-review', 'SKILL.md', '# Changed');
  assert.equal(settingsFileDirty(edited, 'code-review', 'SKILL.md'), true);
  assert.equal(settingsSkillDirty(edited, 'code-review'), true);
  const reverted = editSettingsFile(edited, 'code-review', 'SKILL.md', '# Review');
  assert.equal(settingsFileDirty(reverted, 'code-review', 'SKILL.md'), false);
  assert.equal(settingsDraftDirty(reverted, baseline), false);
});

test('patch carries only explicit deltas across categories and files', () => {
  let draft = editSettingsFile(loaded(), 'code-review', 'SKILL.md', '# Changed');
  draft = { ...draft, skills: ['code-review', 'new-skill'], agents: '', packages: [{ name: 'tools', enabled: false, source: 'Saved Work copy' }] };
  const patch = buildSettingsPatch(draft, baseline);
  assert.deepEqual(patch.addSkills, ['new-skill']);
  assert.equal(patch.removeSkills, undefined);
  assert.deepEqual(patch.skillFiles, [{ skillName: 'code-review', path: 'SKILL.md', text: '# Changed' }]);
  assert.equal(patch.agentsMd, '');
  assert.deepEqual(patch.packageFlags, [{ name: 'tools', enabled: false }]);
  assert.equal(settingsPatchEmpty(patch), false);
});

test('explicit empty values and removals stay distinct from omission', () => {
  const draft = { ...createSettingsDraft(baseline), skills: [], agents: '' };
  const patch = buildSettingsPatch(draft, baseline);
  assert.deepEqual(patch.removeSkills, ['code-review']);
  assert.equal(patch.agentsMd, '');
  assert.equal(settingsPatchEmpty(buildSettingsPatch(createSettingsDraft(baseline), baseline)), true);
});

test('confirmed response updates only captured targets and preserves later edits', () => {
  const draft = editSettingsFile(loaded(), 'code-review', 'SKILL.md', '# One');
  const patch = buildSettingsPatch(draft, baseline);
  const later = editSettingsFile({ ...draft, agents: '# Later' }, 'code-review', 'references/checklist.md', 'later edit');
  const next = confirmSettingsPatch(later, patch);
  assert.equal(next.baselines['code-review']['SKILL.md'], '# One');
  assert.equal(next.files['code-review']['references/checklist.md'], 'later edit');
  assert.equal(next.agents, '# Later');
  assert.equal(settingsFileDirty(next, 'code-review', 'references/checklist.md'), true);
});

test('removed Skill files are not submitted as edits', () => {
  const draft = editSettingsFile({ ...loaded(), skills: [] }, 'code-review', 'SKILL.md', '# Changed');
  const patch = buildSettingsPatch(draft, baseline);
  assert.deepEqual(patch.removeSkills, ['code-review']);
  assert.equal(patch.skillFiles, undefined);
});

test('unknown file save requires original bytes, not matching Skill names', () => {
  const patch = { skillFiles: [{ skillName: 'code-review', path: 'SKILL.md', text: '# Submitted' }], agentsMd: '' };
  const read = { desired: { ...baseline, agentsMd: '' }, files: [] };
  assert.equal(settingsPatchMatchesRead(patch, read), false);
  const file = patch.skillFiles[0];
  assert.equal(settingsPatchMatchesRead(patch, { ...read, files: [{ ...file, text: '# Other' }] }), false);
  assert.equal(settingsPatchMatchesRead(patch, { ...read, files: [file] }), true);
  assert.equal(settingsPatchMatchesRead(patch, { ...read, desired: baseline, files: [file] }), false);
});

test('unknown save checks only captured fields; package and add/remove targets still need evidence', () => {
  const patch = { addSkills: ['new'], removeSkills: ['old'], packageFlags: [{ name: 'tools', enabled: false }] };
  const read = { desired: { skills: ['code-review', 'new'], packages: [{ name: 'tools', enabled: false }], agentsMd: 'a later unrelated value' }, files: [] };
  assert.equal(settingsPatchMatchesRead(patch, read), true);
  assert.equal(settingsPatchMatchesRead(patch, { ...read, desired: { ...read.desired, skills: ['code-review'] } }), false);
  assert.equal(settingsPatchMatchesRead(patch, { ...read, desired: { ...read.desired, skills: ['new', 'old'] } }), false);
  assert.equal(settingsPatchMatchesRead(patch, { ...read, desired: { ...read.desired, packages: [] } }), false);
});

test('known save failure retires by its withdrawn targets while other drafts remain', () => {
  const original = { skillFiles: [{ skillName: 'code-review', path: 'SKILL.md', text: '# Rejected' }] };
  assert.equal(settingsPatchTargetsWithdrawn(original, { agentsMd: 'other unsaved draft' }), true);
  assert.equal(settingsPatchTargetsWithdrawn(original, { skillFiles: [{ skillName: 'code-review', path: 'SKILL.md', text: '# New attempt' }] }), false);
  assert.equal(settingsPatchTargetsWithdrawn({ agentsMd: 'rejected' }, { agentsMd: '' }), false);
});

test('editor preflight keeps UTF-8 and encoded budgets aligned with the shared contract', async () => {
  const { WORK_SETTINGS_LIMITS: limits } = await import(new URL('../../../../packages/contracts/dist/work-settings.js', import.meta.url).href);
  const file = (text: string) => ({ skillName: 'code-review', path: 'SKILL.md', text });
  assert.equal(settingsPatchBudgetProblem({ skillFiles: [file('a'.repeat(limits.fileTextBytes))] }), undefined);
  assert.equal(settingsPatchBudgetProblem({ skillFiles: [file('a'.repeat(limits.fileTextBytes + 1))] }), 'file');
  assert.equal(settingsPatchBudgetProblem({ agentsMd: 'a'.repeat(limits.agentsMdBytes + 1) }), 'agents');
  assert.equal(settingsPatchBudgetProblem({ skillFiles: [file('界'.repeat(Math.ceil(limits.fileTextBytes / 3)))] }), 'file');
  // JSON escaping can exceed the request budget with each file under 1 MiB.
  assert.equal(settingsPatchBudgetProblem({ skillFiles: [file('"'.repeat(limits.fileTextBytes))] }), 'request');
});

test('saved removal no longer keeps detached file drafts globally dirty', () => {
  const draft = editSettingsFile({ ...loaded(), skills: [] }, 'code-review', 'SKILL.md', '# Detached draft');
  assert.equal(settingsDraftDirty(draft, baseline), true);
  const confirmed = { ...baseline, skills: [] };
  const acknowledged = confirmSettingsPatch(draft, { removeSkills: ['code-review'] });
  assert.equal(settingsDraftDirty(acknowledged, confirmed), false);
  assert.deepEqual(buildSettingsPatch(acknowledged, confirmed), {});
  // Undo before saving still restores the original editable draft.
  assert.equal(settingsDraftDirty({ ...draft, skills: ['code-review'] }, baseline), true);
});

test('legal Skill and file names cannot read inherited cache entries', () => {
  const draft = createSettingsDraft({ ...baseline, skills: ['constructor'] });
  assert.equal(settingsListedFiles(draft, 'constructor'), undefined);
  assert.equal(settingsLoadedText(draft, 'constructor', 'SKILL.md'), undefined);
  const loaded = applySettingsRead(draft, 'constructor', [
    { path: '__proto__', size: 6, editable: true, reason: null },
    { path: 'constructor', size: 4, editable: true, reason: null },
  ], Object.fromEntries([['__proto__', 'proto text'], ['constructor', 'constructor text']]));
  assert.equal(settingsLoadedText(loaded, 'constructor', '__proto__'), 'proto text');
  assert.equal(settingsLoadedText(loaded, 'constructor', 'constructor'), 'constructor text');
  const changed = editSettingsFile(loaded, 'constructor', '__proto__', 'edited');
  assert.equal(settingsFileDirty(changed, 'constructor', '__proto__'), true);
  assert.equal(settingsLoadedText(changed, 'constructor', '__proto__', true), 'proto text');
  assert.equal(Object.hasOwn(Object, 'SKILL.md'), false);
});

test('a newer Core snapshot cannot turn untouched fields into edits', () => {
  const draft = editSettingsFile(loaded(), 'code-review', 'SKILL.md', '# Local');
  const latest = { ...baseline, agentsMd: '# External', packages: [{ name: 'tools', enabled: false }] };
  assert.deepEqual(buildSettingsPatch(draft, latest), { skillFiles: [{ skillName:'code-review',path:'SKILL.md',text:'# Local' }] });
  const refreshed = rebaseSettingsDraft(draft, latest);
  assert.equal(refreshed.agents, '# External');
  assert.equal(refreshed.packages[0].enabled, false);
  assert.deepEqual(buildSettingsPatch(refreshed, latest), buildSettingsPatch(draft, latest));
});

test('package edits retain their captured scope until confirmation then adopt untouched updates', () => {
  const initial = { ...baseline, packages: [{ name: 'one', enabled: true }, { name: 'two', enabled: true }] };
  const draft = createSettingsDraft(initial);
  draft.packages[0].enabled = false;
  const latest = { ...initial, packages: [{ name: 'one', enabled: true }, { name: 'two', enabled: false }] };
  const refreshed = rebaseSettingsDraft(draft, latest);
  assert.deepEqual(buildSettingsPatch(refreshed, latest), { packageFlags: [{ name:'one',enabled:false }] });
  const confirmed = confirmSettingsPatch(refreshed, buildSettingsPatch(refreshed, latest));
  const saved = { ...latest, packages: latest.packages.map(item => ({ ...item, enabled: false })) };
  const result = rebaseSettingsDraft(confirmed, saved);
  assert.equal(result.packages[1].enabled, false);
  assert.equal(settingsDraftDirty(result, saved), false);
});

test('late edits survive captured field confirmation and later unrelated refresh', () => {
  const draft = { ...loaded(), agents: '# Submitted' };
  const patch = buildSettingsPatch(draft, baseline);
  const later = { ...draft, agents: '# Later' };
  const saved = { ...baseline, agentsMd: '# Submitted', packages: [{ name:'tools',enabled:false }] };
  const next = rebaseSettingsDraft(confirmSettingsPatch(later, patch), saved);
  assert.equal(next.agents, '# Later');
  assert.deepEqual(buildSettingsPatch(next, saved), { agentsMd: '# Later' });
});

test('refresh during a file edit never resurrects a remotely removed Skill from Core', () => {
  const draft = editSettingsFile(loaded(), 'code-review', 'SKILL.md', '# Local');
  const latest = { ...baseline, skills: ['other'] };
  const next = rebaseSettingsDraft(draft, latest);
  const patch = buildSettingsPatch(next, latest);
  assert.equal(patch.addSkills, undefined);
  assert.equal(patch.removeSkills, undefined);
  assert.deepEqual(patch.skillFiles, [{skillName:'code-review',path:'SKILL.md',text:'# Local'}]);
  assert.equal(next.files['code-review']['SKILL.md'], '# Local');
});

test('confirmation advances an explicitly submitted installed package absent from the older form baseline', () => {
  const draft = createSettingsDraft(baseline);
  draft.packages.push({ name:'installed-later',enabled:true });
  const patch = buildSettingsPatch(draft, baseline);
  const saved = { ...baseline, packages: [...baseline.packages,{name:'installed-later',enabled:true}] };
  const next = rebaseSettingsDraft(confirmSettingsPatch(draft, patch), saved);
  assert.equal(settingsDraftDirty(next, saved), false);
  assert.deepEqual(buildSettingsPatch(next, saved), {});
});
