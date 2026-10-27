import { catalog as valid } from './desktop-valid.js';

const catalog = structuredClone(valid);
catalog['zh-CN']['term.core'] = '核心';
export { catalog };
