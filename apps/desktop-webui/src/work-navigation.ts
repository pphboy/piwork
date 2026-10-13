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
