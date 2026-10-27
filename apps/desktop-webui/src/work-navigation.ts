import type { Work } from './models.js';
import { t, stateText } from './locale.js';
export interface WorkSelection { area: string; path: string; file: string; service: string; port: number; session: string }
export function restoreSelection(previous?: WorkSelection): WorkSelection {
  return { area: previous && ['Services', 'Chat', 'Files'].includes(previous.area) ? previous.area : 'Services',
    path: previous?.path || '/', file: previous?.file || '', service: previous?.service || '',
    port: previous?.port || 0, session: previous?.session || '' };
}
export function parentDirectory(path: string): string {
  return path.replace(/\/+$/, '').slice(0, path.replace(/\/+$/, '').lastIndexOf('/')) || '/';
}
export function missingFileTarget(status?: number): boolean { return status === 404 || status === 410; }

/** Choose only after real reads; never replace an explicit restored area. */
export function initialWorkArea(previous: WorkSelection | undefined, work: Work, usable: boolean, chatReady: boolean): string {
  if (previous && ['Services', 'Chat', 'Files'].includes(previous.area)) return previous.area;
  const confirmed = !!work.resourceChecked?.services && !!work.resourceChecked?.agent && !work.resourceErrors?.services && !work.resourceErrors?.agent;
  return usable && chatReady && confirmed && !work.services.some(service => service.enabled && service.observed === 'Ready' && service.ports.length) ? 'Chat' : 'Services';
}
export function unavailableServicesReason(work: Work): string {
  if (!work.resourceChecked?.services || work.resourceErrors?.services || work.services.some(service => service.enabled && service.observed === 'Ready' && service.ports.length)) return '';
  if (!work.services.length) return t('d.nav.noServices');
  return t('d.nav.noWebService') + work.services.map(service => t('d.nav.serviceState', {
    name: service.name,
    state: !service.enabled ? t('d.nav.disabled') : stateText(service.observed.toLowerCase()),
    entry: !service.ports.length ? t('d.nav.noEntry') : '',
    error: service.error ? ` · ${service.error}` : '',
  })).join('; ');
}
