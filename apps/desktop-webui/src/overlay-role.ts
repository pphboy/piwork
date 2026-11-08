/** Presentation only: action admission, object identity and write locks stay in their owners. */
export function overlayRole(name: string): 'menu' | 'popover' | 'drawer' | 'modal' {
  if (['account', 'work-menu', 'agent-menu', 'service-menu', 'file-menu'].includes(name)) return 'menu';
  // The Works task list is a non-modal disclosure of the current identity's own
  // outstanding tasks, not a global operations centre.
  if (name === 'works-tasks') return 'drawer';
  if (['chat-history-status', 'chat-submission', 'service-picker', 'sessions', 'chat-response-settings', 'chat-input-options', 'connection', 'service-details', 'work-info', 'skill-detail'].includes(name)) return 'popover';
  if (['operations', 'operation', 'run-details', 'package-detail', 'export-recovery'].includes(name)) return 'drawer';
  return 'modal';
}
export function anchoredOverlay(name: string) { return ['menu', 'popover'].includes(overlayRole(name)); }
/** A still-owned response picker survives viewport shrink without changing other popover dismissal. */
export function overlayAnchorBounds(name: string, anchor: Readonly<{left:number;right:number;top:number;bottom:number}>, viewport: Readonly<{width:number;height:number}>) {
  const outside = anchor.bottom < 0 || anchor.top > viewport.height || anchor.right < 0 || anchor.left > viewport.width;
  if (!outside) return anchor;
  if (name !== 'chat-response-settings') return undefined;
  const clamp = (value: number, extent: number) => Math.max(Math.min(8, extent / 2), Math.min(value, Math.max(extent / 2, extent - 8)));
  return { left: clamp(anchor.left, viewport.width), right: clamp(anchor.right, viewport.width),
    top: clamp(anchor.top, viewport.height), bottom: clamp(anchor.bottom, viewport.height) };
}
export function overlayPlacement(anchor: {left:number;right:number;top:number;bottom:number}, size: {width:number;height:number}, viewport: {width:number;height:number}) {
  const margin=8,gap=6,width=Math.min(size.width,Math.max(0,viewport.width-margin*2));
  const below=viewport.height-anchor.bottom-gap-margin,above=anchor.top-gap-margin;
  const upward=below<Math.min(size.height,240) && above>below;
  const maxHeight=Math.max(0,(upward?above:below));
  const height=Math.min(size.height,maxHeight);
  return {left:Math.max(margin,Math.min(anchor.left,viewport.width-width-margin)),top:Math.max(margin,upward?anchor.top-gap-height:anchor.bottom+gap),maxHeight};
}
export function menuDestination(key: string, index: number, count: number) {
  if(!count)return -1;
  if(key==='Home')return 0;
  if(key==='End')return count-1;
  if(key==='ArrowDown')return (index+1+count)%count;
  if(key==='ArrowUp')return (index-1+count)%count;
  return -1;
}

export function overlayForAction(action: string) { return ['open-chat-settings', 'open-thinking-settings'].includes(action) ? 'chat-response-settings' : action; }
