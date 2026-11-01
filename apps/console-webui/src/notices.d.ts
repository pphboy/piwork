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
  setPageRegion(region: { readonly header: HTMLElement | null; readonly toolbars?: readonly HTMLElement[]; readonly footers?: readonly HTMLElement[] } | null): void;
  setModalRegion(region: { readonly container: HTMLElement; readonly header: HTMLElement | null; readonly footer: HTMLElement | null } | null): void;
  destroy(): void;
};

export function noticeModalPlacement(input: {
  readonly width: number;
  readonly height: number;
  readonly viewportLeft?: number;
  readonly viewportTop?: number;
  readonly container: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };
  readonly headerBottom: number;
  readonly footerTop: number;
  readonly noticeHeight?: number;
  readonly pageHeaderBottom?: number;
}): { readonly left: number; readonly top: number; readonly width: number; readonly maxHeight: number } | null;

export function noticePagePlacement(input: {
  readonly notice: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };
  readonly header?: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number } | null;
  readonly toolbars?: readonly { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }[];
  readonly footers?: readonly { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }[];
  readonly viewportTop?: number;
  readonly viewportHeight: number;
}): { readonly top: number; readonly maxHeight: number } | null;
