export interface FileDropTarget {
  epoch: number;
  workId: string;
  directory: string;
  view: string;
}

export function sameFileDropTarget(left: FileDropTarget, right: FileDropTarget): boolean {
  return left.epoch === right.epoch && left.workId === right.workId &&
    left.directory === right.directory && left.view === right.view;
}

export function droppedFiles(items: Iterable<DataTransferItem>): File[] | undefined {
  const entries = Array.from(items).filter(item => item.kind === 'file');
  if (!entries.length) return undefined;
  const files: File[] = [];
  for (const item of entries) {
    try {
      const entry = item.webkitGetAsEntry?.() ?? null;
      if (!entry?.isFile) return undefined;
      const file = item.getAsFile();
      if (!file) return undefined;
      files.push(file);
    } catch { return undefined; }
  }
  return files;
}
