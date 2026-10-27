import { catalog as valid } from './desktop-valid.js';

const catalog = structuredClone(valid);
catalog.en['view.empty'] = '';
catalog['zh-CN']['view.empty'] = '空值夹具';
export { catalog };
