import { t } from './locale.js';

type Field = { label: string; required: boolean } & (
  { type: 'text' } | { type: 'single' | 'multi'; options: string[] }
);
export type ChatForm = ReadonlyArray<Field>;
// Choice controls store option indices as strings. Text controls store the entered text.
export type ChatFormAnswers = ReadonlyArray<ReadonlyArray<string>>;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function parseChatForm(text: string): ChatForm | undefined {
  let declaration: unknown;
  try { declaration = JSON.parse(text); } catch { return; }
  if (!record(declaration) || !Array.isArray(declaration.fields) || !declaration.fields.length) return;
  const fields: Field[] = [];
  const labels = new Set<string>();
  for (const field of declaration.fields) {
    if (!record(field) || typeof field.label !== 'string' || !field.label.trim()) return;
    if (field.required !== undefined && typeof field.required !== 'boolean') return;
    const label = field.label.trim();
    if (labels.has(label)) return;
    labels.add(label);
    const required = field.required === true;
    if (field.type === 'text') {
      fields.push({ type: field.type, label, required });
    } else if (field.type === 'single' || field.type === 'multi') {
      if (!Array.isArray(field.options) || !field.options.length) return;
      if (!field.options.every((option): option is string => typeof option === 'string' && !!option.trim())) return;
      const options = field.options.map(option => option.trim());
      if (new Set(options).size !== options.length) return;
      fields.push({ type: field.type, label, required, options });
    } else return;
  }
  return fields;
}

export function readChatForm(form: HTMLFormElement): ChatFormAnswers {
  const values = new FormData(form);
  return Array.from(form.querySelectorAll('fieldset'), (_, index) => values.getAll(`field-${index}`).map(String));
}

export function chatFormMessage(fields: ChatForm, answers: ChatFormAnswers) {
  const lines: string[] = [];
  for (const [index, field] of fields.entries()) {
    const selected = answers[index] ?? [];
    const value = field.type === 'text'
      ? selected[0]?.trim()
      : field.options.filter((_, choice) => selected.includes(String(choice))).join(t('chat.formOptionSeparator'));
    if (!value && field.required) return { missing: index };
    if (value) lines.push(`${field.label} ${value}`);
  }
  return lines.length ? { text: lines.join('\n') } : {};
}

export function renderChatForm(
  fields: ChatForm, escape: (value: string) => string,
  draft?: { id: string; answers?: ChatFormAnswers; canSend: boolean },
): string {
  if (!draft) return `<div class="chat-form">${fields.map(field => `<div>${escape(field.label)}${field.type === 'text' ? '' : `<ul>${field.options.map(option => `<li>${escape(option)}</li>`).join('')}</ul>`}</div>`).join('')}</div>`;
  const controls = fields.map((field, index) => {
    const name = `field-${index}`;
    const id = `${draft.id}-${name}`;
    const selected = draft.answers?.[index] ?? [];
    const required = field.required ? ` <span class="muted">${escape(t('chat.formRequired'))}</span>` : '';
    const label = escape(field.label) + required;
    if (field.type === 'text') {
      return `<fieldset><label for="${id}">${label}</label><textarea rows="1" id="${id}" name="${name}"${field.required ? ' required' : ''}>\n${escape(selected[0] ?? '')}</textarea></fieldset>`;
    }
    const type = field.type === 'single' ? 'radio' : 'checkbox';
    const requiredChoice = type === 'radio' && field.required ? ' required' : '';
    const options = field.options.map((option, choice) => {
      const checked = selected.includes(String(choice)) ? ' checked' : '';
      return `<label class="chat-form-option"><input type="${type}" id="${id}-${choice}" name="${name}" value="${choice}"${checked}${requiredChoice}><span>${escape(option)}</span></label>`;
    }).join('');
    return `<fieldset><legend>${label}</legend><div class="chat-form-options">${options}</div></fieldset>`;
  }).join('');
  return `<form class="chat-form" id="${draft.id}" data-chat-form>${controls}<button type="submit" class="button primary small" id="${draft.id}-send"${draft.canSend ? '' : ' disabled'}>${escape(t('chat.formSend'))}</button></form>`;
}
