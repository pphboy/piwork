// Development inventory: declarations plus direct static/dynamic consumers.
// Final release checks also compile remaining consumers and inspect images.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
const root = resolve(import.meta.dirname,"..");
async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory,{withFileTypes:true})) {
    if (["node_modules","dist",".git"].includes(entry.name)) continue;
    const path = resolve(directory,entry.name);
    if (entry.isDirectory()) files.push(...await walk(path)); else files.push(path);
  }
  return files;
}
const all = [...await walk(`${root}/apps`),...await walk(`${root}/packages`)];
const ts = all.filter(x => x.endsWith(".ts"));
const packages = [];
for (const path of all.filter(x => x.endsWith("/package.json") && x.split("/").length === root.split("/").length+3)) {
  const value = JSON.parse(await readFile(path,"utf8"));
  packages.push({ path:relative(root,dirname(path)), name:value.name, productionDependencies:value.dependencies ?? {}, developmentDependencies:value.devDependencies ?? {} });
}
const imports = [];
const contents = new Map();
for (const path of ts) {
  const source = await readFile(path,"utf8"); contents.set(path,source);
  for (const match of source.matchAll(/^\s*(?:import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']/gm)) {
    const clause = match[1], specifier = match[2];
    const brace = /\{([^}]+)\}/.exec(clause);
    const symbols = brace ? brace[1].split(",").map(x => x.trim().replace(/^type\s+/,"").split(/\s+as\s+/)[0]).filter(Boolean) : [clause.includes("*") ? "*" : clause.trim().replace(/^type\s+/,"")];
    imports.push({ consumer:relative(root,path), specifier, symbols, test:/\.(?:test|integration)\.ts$/.test(path) || path.includes("/testing/") });
  }
  for (const match of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) imports.push({consumer:relative(root,path),specifier:match[1],symbols:["*"],test:/\.(?:test|integration)\.ts$/.test(path)});
}
function plan(path, symbol) {
  if (path.startsWith("apps/agentd/")) return { action:"保留完整 harness",target:path };
  if (path.startsWith("packages/pi-adapter/")) return { action:path.includes("/testing/") ? "保留开发/acceptance fixture" : "保留 SDK adapter",target:path };
  if (path.startsWith("packages/work-store/")) return {action:"保留 Agent 私有 schema 3 store、历史与迁移",target:path};
  if (path.startsWith("apps/desktop-webui/src/")) return {action:"保留浏览器源码",target:"apps/desktop-webui"};
  if (path.startsWith("apps/console-webui/src/")) return {action:"保留浏览器源码",target:"apps/console-webui"};
  if (path.startsWith("packages/pi-package/")) {
    const file = path.split("/").at(-1);
    if (["artifact-sync.ts","artifact.ts","inventory.ts","manifest.ts","limits.ts","index.ts"].includes(file)) return {action:"保留 Agent 包清单、环境与内容核验",target:path};
    return {action:"仅保留 Agent 测试",target:path};
  }
  if (path.startsWith("packages/contracts/")) {
    return {action:"保留 Agent RPC 与 harness 消费的最小 TS 类型",target:path};
  }
  return {action:"平台生产实现迁 Go 后删除",target:path.includes("/core") ? "internal/core、internal/corestore" : path.includes("/cli") ? "internal/client、internal/cli、internal/desktop" : path.includes("/console") ? "internal/console" : "Go 平台模块"};
}
const selected = ts.filter(x => !/\.(?:test|integration)\.ts$/.test(x) && ["apps/agentd/","apps/desktop-webui/src/","apps/console-webui/src/","packages/pi-adapter/","packages/work-store/","packages/pi-package/","packages/contracts/"].some(prefix => relative(root,x).startsWith(prefix)));
const modules = selected.map(file => {
  const path = relative(root,file), source = contents.get(file);
  const exported = [...source.matchAll(/^export\s+(?:(?:declare|async|abstract)\s+)*(?:class|interface|type|function|const|enum|let)\s+([\w$]+)/gm)].map(x => x[1]);
  const reexports = [...source.matchAll(/^export\s+(\{[^}]+\}|\*)\s+from\s+["']([^"']+)["']/gm)].map(x => ({clause:x[1].replace(/\s+/g," "),source:x[2]}));
  const packageInfo = packages.find(pkg => path.startsWith(pkg.path+"/"));
  const direct = imports.filter(entry => entry.specifier === packageInfo?.name || (entry.specifier.startsWith(".") && resolve(root,dirname(entry.consumer),entry.specifier.replace(/\.js$/,".ts")) === file));
  return {path,plan:plan(path),imports:imports.filter(x => x.consumer === path),reexports,
    exports:exported.map(symbol => ({symbol,plan:plan(path,symbol),consumers:direct.filter(entry => entry.symbols.includes(symbol) || entry.symbols.includes("*"))}))};
});
const retainedPackages = packages.filter(pkg => ["@piwork/agentd","@piwork/pi-adapter","@piwork/work-store","@piwork/pi-package","@piwork/contracts"].includes(pkg.name));
const programs = [
  ["piwork-serve","宿主 Core/operator","dist/go/piwork-serve","无解释器；piwork 别名"],
  ["piwork-cli","宿主用户 CLI/proxy/Desktop","dist/go/piwork-cli","嵌入 Desktop browser assets"],
  ["piwork-console","宿主 Console","dist/go/piwork-console","嵌入 Console browser assets"],
  ["piwork-service-mcp","Agent production/acceptance 镜像","/usr/local/bin/piwork-service-mcp","stdio；io.piwork.service-mcp.contract=1"],
  ["piwork-package-helper","Agent/package 准备镜像","/usr/local/bin/piwork-package-helper","prepare/init/capture/measure；io.piwork.package-helper.contract=2"],
  ["piwork-file-helper","原生 file-helper 镜像","/usr/local/bin/piwork-file-helper","stdin/stdout framed protocol；镜像无 Node/Python"],
  ["piwork-snapshot-helper","原生 snapshot-helper 镜像","/usr/local/bin/piwork-snapshot-helper","capture/restore/history/package 固定入口；无解释器"],
].map(([name,owner,entry,boundary]) => ({name,source:`cmd/${name}/main.go`,owner,entry,boundary,status:"已实现；发布镜像验收另见验收记录"}));
const inventory = {baseline:"23870cfbec6ad88a60eea008f9c5f106410c3fb5",state:"当前源码与直接消费者清单；镜像和进程边界另行验收",modules:modules.sort((a,b) => a.path.localeCompare(b.path)),packages:retainedPackages,programs,
  browserAssets:all.filter(x => /apps\/(?:desktop-webui|console-webui)\/.*\.(?:html|css|svg)$/.test(x)).map(x => relative(root,x)).sort(),
  devTools:JSON.parse(await readFile(`${root}/package.json`,"utf8")).devDependencies,
  dependencyNotes:["Agent 镜像 Node/npm/Git、Pi SDK、grpc-js、MCP TS SDK、typebox/zod/semver 保留其实际消费者闭包", "pi-package 的 ZIP/source/upload I/O 与 yauzl/yazl 已删除；limits 属于共享核验常量", "宿主三个入口和镜像内四个辅助程序均为 Go；前端编译、proto 生成、测试 runner 为开发依赖", "work-store store/migrations、完整 Agent RPC/readiness/drain/Session/Run/MCP 客户端保留 TS", "用户 Service/Pi 包/workspace 中的 TS/其他语言不纳入平台删除检查"]};
await writeFile(`${root}/docs/go-migration-boundary.json`,`${JSON.stringify(inventory,null,2)}\n`);
console.log(`Collected ${modules.length} source modules, ${modules.reduce((n,m) => n+m.exports.length,0)} declared exports and seven Go programs.`);
