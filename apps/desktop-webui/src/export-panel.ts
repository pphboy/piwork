import type { ExportFlow, ExportTransfer } from './export-flow.js';
import type { Snapshot } from './models.js';
import { exportSnapshotAvailable } from './export-admission.js';
import { t, stateText } from './locale.js';
import { pendingDots } from './pending.js';

/** Only export-owned facts cross this presentation boundary. No adapter or app view. */
export interface ExportPanelInput {
  readonly work?: Readonly<{ id: string; name: string }>;
  readonly flow?: Readonly<ExportFlow>;
  readonly snapshot?: Readonly<Snapshot>;
  readonly transfer?: Readonly<ExportTransfer & {
    transferred?: number;
    total?: number;
  }>;
  readonly activeFlow?: Readonly<Pick<ExportFlow, 'workId' | 'snapshotId' | 'terminal'>>;
  readonly snapshots?: readonly Readonly<Snapshot>[];
  readonly snapshotQuery?: string;
}
export interface ExportPanelModel {
  readonly workId: string;
  readonly workName: string;
  readonly title: string;
  readonly summary: string;
  readonly waiting: boolean;
  readonly error: string;
  readonly flow?: Readonly<ExportFlow>;
  readonly snapshot?: Readonly<Snapshot>;
  readonly transfer?: ExportPanelInput['transfer'];
  readonly canSave: boolean;
  readonly canDownload: boolean;
  readonly busy: boolean;
  readonly downloadBlocked: boolean;
}
export interface ExportPanelMarkup {
  title: string;
  body: string;
  footer: string;
}

/** Commands remain owned by ExportFlows; presentation never unlocks or submits. */
export interface ExportPanelControlPort {
  check(id: string): Promise<void>;
  pause(id: string): void;
  resume(id: string): Promise<void>;
}

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]!));
function button(label: string, action: string, id = '', role = '', disabled = false, workId = '') {
  return `<button class="button ${role}" data-action="${action}"${id ? ` data-id="${esc(id)}"` : ''}${workId ? ` data-work-id="${esc(workId)}"` : ''}${disabled ? ' disabled' : ''}>${esc(label)}</button>`;
}

export function exportPanelModel(input: ExportPanelInput, now = Date.now()): ExportPanelModel {
  const workId = input.flow?.workId || input.work?.id || input.snapshot?.workId || '';
  const flow = input.flow;
  const snapshot = input.snapshot?.workId === workId && (!flow?.snapshotId || flow.snapshotId === input.snapshot.id)
    ? input.snapshot : undefined;
  const transfer = snapshot && input.transfer?.snapshotId === snapshot.id && input.transfer.workId === workId &&
    (!flow?.transferId || flow.transferId === input.transfer.transferId)
    ? input.transfer : undefined;
  const available = !!snapshot && exportSnapshotAvailable(snapshot, now);
  const canSave = available && !!transfer?.ready;
  const expired = snapshot?.status === 'expired' || snapshot?.status === 'verified' && !!snapshot.expiresAt && Number.isFinite(Date.parse(snapshot.expiresAt)) && Date.parse(snapshot.expiresAt) <= now;
  const terminalError = flow && ['failed', 'unknown', 'revoked'].includes(flow.phase) ? flow.error : '';
  const error = terminalError || (flow?.feedbackIssue ? flow.feedbackError : '') || flow?.error || snapshot?.error || transfer?.error || transfer?.observationError ||
    (expired ? t('export.packageExpired') : snapshot?.status === 'unavailable' ? t('export.packageUnavailable') : '');
  const busy = input.activeFlow?.workId === workId && !input.activeFlow.terminal;
  return {
    workId, workName: flow?.workName || input.work?.name || workId,
    title: flow ? t(`export.phase.${flow.phase}`) : t('export.packageTitle'),
    summary: flow?.paused ? t('export.pausedBody') : flow?.phase === 'delivered' ? t('export.deliveredBody') : !flow ? t('export.packageBody') : t('export.keepWorking'),
    waiting: !!flow && !flow.paused && ['checking', 'stopping', 'exporting', 'snapshot', 'preparing'].includes(flow.phase) && !error,
    error, flow, snapshot, transfer, canSave, busy,
    canDownload: available && (!flow || flow.phase === 'failed' && !!transfer?.terminalFailure),
    downloadBlocked: busy && input.activeFlow?.snapshotId !== snapshot?.id,
  };
}

function transferProgress(model: ExportPanelModel) {
  const transfer = model.transfer;
  if (!transfer) return '';
  const count = typeof transfer.transferred === 'number' && Number.isFinite(transfer.transferred) && transfer.transferred >= 0 ? transfer.transferred : undefined;
  const total = typeof transfer.total === 'number' && Number.isFinite(transfer.total) && transfer.total > 0 ? transfer.total : undefined;
  const bytes = count === undefined ? '' : ` · ${esc(count)}${total ? ` / ${esc(total)}` : ''} ${esc(t('progress.bytes'))}`;
  return `<p class="export-transfer-progress">${esc(t('progress.transfer'))} · ${esc(stateText(transfer.phase || transfer.state || ''))}${bytes}</p>${total && count !== undefined ? `<progress value="${Math.min(count, total)}" max="${total}" aria-label="${esc(t('progress.transferBytes'))}"></progress>` : ''}`;
}
function downloadButton(model: ExportPanelModel) {
  const { flow, snapshot, transfer } = model;
  if (model.canSave) return button(flow?.autoDeliveryConsumed ? t('export.downloadAgain') : t('editor.saveFile'), 'save-export-file', snapshot!.id, 'primary');
  if (model.canDownload) return button(transfer?.terminalFailure ? t('export.retryDownload') : t('export.downloadSnapshot'), 'download-work', snapshot!.id, 'primary', model.downloadBlocked);
  return '';
}

/** Non-modal current-task progress. No diagnostic IDs or previous package inventory. */
export function renderExportPanel(model: ExportPanelModel): ExportPanelMarkup {
  const flow = model.flow;
  const flowControls = flow && !flow.terminal
    ? button(t('quick.checkStatus'), 'check-export-flow', flow.id, 'small') + button(flow.paused ? t('export.resume') : t('export.pause'), flow.paused ? 'resume-export-flow' : 'pause-export-flow', flow.id, 'small')
    : '';
  const controls = flowControls + (model.snapshot && model.transfer ? button(t('progress.checkTransfer'), 'check-download', model.snapshot.id, 'small') : '');
  const pending = model.waiting ? `<span class="pending-status" role="status" aria-busy="true" data-pending-action="export prepare-export download-work check-export-flow resume-export-flow save-export-file check-download" data-pending-label="${esc(model.title)}">${pendingDots()}<span>${esc(model.title)}</span></span> ` : '';
  const body = [
    `<p class="export-work-name">${esc(model.workName)}</p>`,
    `<p class="export-summary" role="status">${pending}${esc(model.summary)}</p>`,
    model.error ? `<p class="export-error" role="status">${esc(model.error)}</p>` : '',
    `<p class="export-privacy">${esc(t('export.privacy'))}</p>`,
    `<details class="export-details"><summary>${esc(t('common.details'))}</summary>`,
    `<p>${esc(model.title)}</p>`,
    transferProgress(model),
    controls ? `<div class="actions">${controls}</div>` : '',
    `<p class="muted">${esc(t('export.closingNote'))}</p></details>`,
  ].join('');
  const retry = flow?.phase === 'unknown' && !model.canSave ? button(t('quick.checkStatus'), 'check-export-flow', flow.id, 'primary') : '';
  return {
    title: model.title, body,
    footer: button(flow && !flow.terminal ? t('export.hide') : t('common.close'), 'close-modal') + (downloadButton(model) || retry),
  };
}

/** Explicitly opened, Work-scoped diagnostics. Never embedded in progress Details. */
export function renderExportRecoveryPanel(input: ExportPanelInput): ExportPanelMarkup {
  const model = exportPanelModel(input);
  const { flow, snapshot } = model;
  const row = (label: string, value: string) => `<dt>${esc(label)}</dt><dd>${value}</dd>`;
  const copyableID = (id: string) => `<code>${esc(id)}</code> <button class="button small" data-action="copy" data-copy="${esc(id)}">${esc(t('common.copy'))}</button>`;
  const operation = (id?: string) => id ? button(id, 'operation', id, 'text-button') : '';
  const facts = (flow?.stopOperationId ? row(t('export.stopLabel'), operation(flow.stopOperationId)) : '') +
    (flow?.exportOperationId || snapshot?.operationId ? row(t('export.exportLabel'), operation(flow?.exportOperationId || snapshot?.operationId)) : '') +
    (snapshot ? row(t('export.snapshotLabel'), copyableID(snapshot.id)) + row(t('export.statusLabel'), esc(stateText(snapshot.status))) + row(t('export.sizeLabel'), esc(snapshot.size || t('text.notProvided'))) + row(t('export.expiresLabel'), esc(snapshot.expiresAt || t('text.notProvided'))) : '');
  const transferIdentity = model.transfer?.transferId || flow?.transferId;
  const transferFact = transferIdentity ? row(t('progress.transfer'), copyableID(transferIdentity)) : '';
  const known = (input.snapshots || []).filter(value => value.workId === model.workId && value.id !== snapshot?.id);
  const lookup = model.workId ? `<label class="field">${esc(t('ops.findSnapshot'))}<div class="input-action"><input id="snapshot-query" value="${esc(input.snapshotQuery)}" placeholder="snapshot-…">${button(t('ops.findSnapshotButton'), 'lookup-snapshot', '', '', false, model.workId)}</div></label>` : '';
  const body = [
    `<p class="export-work-name">${esc(model.workName)}</p>`,
    `<p>${esc(t('recovery.previousExportBody'))}</p>`,
    model.error ? `<p role="status">${esc(model.error)}</p>` : '',
    `<p class="export-privacy">${esc(t('export.privacy'))}</p>`,
    '<section class="export-recovery export-details">',
    (facts || transferFact) ? `<dl class="export-snapshot">${facts}${transferFact}</dl>` : '',
    lookup,
    model.snapshot && model.transfer
      ? `<div class="actions">${button(t('progress.checkTransfer'), 'check-download', model.snapshot.id, 'small')}</div>` : '',
    known.length ? `<h3>${esc(t('export.otherPackages'))}</h3><div class="menu-list">${known.map(value =>
      button(`${value.id} · ${stateText(value.status)}`, 'view-snapshot', value.id, '', false, value.workId)).join('')}</div>` : '',
    '</section>',
  ].join('');
  const fresh = !flow && model.workId && ['expired', 'unavailable'].includes(snapshot?.status || '') ? button(t('export.exportCurrentWork'), 'prepare-export', model.workId, 'primary', model.busy) : '';
  const progress = flow ? button(t('export.progress'), 'show-export-progress', flow.id, '', false, model.workId) : '';
  return { title: t('recovery.previousExport'), body, footer: button(t('common.close'), 'close-modal') + progress + (downloadButton(model) || fresh) };
}
