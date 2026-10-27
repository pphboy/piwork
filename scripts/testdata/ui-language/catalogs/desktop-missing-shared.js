import { catalog as valid } from './desktop-valid.js';

const catalog = structuredClone(valid);
delete catalog.en['term.work'];
delete catalog['zh-CN']['term.work'];
export { catalog };
