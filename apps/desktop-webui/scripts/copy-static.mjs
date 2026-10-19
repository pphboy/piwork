import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const target = new URL("../dist/public/", import.meta.url);
mkdirSync(target, { recursive: true });
cpSync(new URL("../public/", import.meta.url), target, { recursive: true });
cpSync(new URL("../../../apps/ui-shared/assets/piwork-logo.png", import.meta.url), new URL("piwork-logo.png", target));
const tokens = readFileSync(new URL("../../ui-shared/tokens.css", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
writeFileSync(new URL("style.css", target), tokens + "\n" + styles);
// Keep the upstream standalone module flat for the existing embedded asset route.
const markedModule = new URL(import.meta.resolve('marked'));
const browser = new URL('../dist/browser/', import.meta.url);
mkdirSync(browser, { recursive: true });
cpSync(markedModule, new URL('marked.js', browser));
cpSync(new URL('../LICENSE', markedModule), new URL('marked-LICENSE.txt', target));

cpSync(new URL("../../../apps/ui-shared/browser-crypto.js", import.meta.url), new URL("../dist/browser/browser-crypto.js", import.meta.url));
