export interface NoticeEvent {
  readonly identity: string;
  readonly key: string;
  readonly object: string;
  readonly task: string;
  readonly generation: string | number;
  readonly tone: 'success' | 'error' | 'unknown' | 'warning';
  readonly message: () => string;
  readonly recovery?: { readonly label: () => string; readonly run: () => void };
}
export interface NoticeItem extends NoticeEvent { readonly id: string; readonly expires?: number }
export class NoticeStore {
  constructor(options?: { now?: () => number; onChange?: () => void });
  readonly identity: string;
  setIdentity(identity: string): void;
  publish(event: NoticeEvent): boolean;
  resolve(owner: Pick<NoticeEvent, 'identity' | 'object' | 'task' | 'generation'>): void;
  dismiss(id: string): void;
  items(): readonly NoticeItem[];
  destroy(): void;
}
export function createNoticeHost(store: NoticeStore, options: { document: Document; closeLabel: () => string }): {
  readonly element: HTMLElement;
  render(): void;
  destroy(): void;
};
