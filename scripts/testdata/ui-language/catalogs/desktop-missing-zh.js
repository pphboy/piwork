import { catalog as valid } from './desktop-valid.js';

const catalog = structuredClone(valid);
delete catalog['zh-CN']['view.hello'];
export { catalog };
