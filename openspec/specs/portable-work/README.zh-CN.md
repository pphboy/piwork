# Work 规范

[English](README.md) | **简体中文**

Work 将 Agent harness、Service 与持久工作区连接起来。**Manifest（版本化 Work Spec 值）**描述一次完整冷快照；**Work Package** 是清单及全部引用字节组成的 `.work` 文件；导入后的 **Work Instance** 使用接收者的独立身份与可变存储。

本文说明 V1 和本源码树已实现、尚未发布的 V2。包含 V2 的当前行为约束见 [portable-work](spec.md) 和 [work-snapshots](../work-snapshots/spec.md)；设计与验收记录保留在已归档的 [compress-work-packages](../../changes/archive/2026-11-09-compress-work-packages/) 变更中。

## Manifest 与引用关系

| 字段 | 含义 |
| --- | --- |
| `formatVersion`、`snapshotKind` | 包封装版本 1/2，快照种类 cold-full |
| `createdAt`、`sourceName` | 快照生成时间与源名称 |
| `compatibility` | Linux 平台、Agent 协议、历史 schema、存储布局与包契约 |
| `contexts`、`activeContext`、`desiredContext` | 全部保留执行配置，active 可为 null |
| `piPackageArtifacts` | 已准备的完整包树及依赖，按内容寻址 |
| `services` | Service 定义、修订、heads 和保留 tombstone |
| `quotaReservations` | Agent/Service 的持久资源预留 |
| `volumes` | 恰好 private/workspace 两棵树及逻辑引用 |
| `images` | 固定镜像 config 与原始层摘要及离线内容 |
| `bindings` | 非秘密模型要求与外部 MCP secret 依赖 |
| `history` | 控制历史与声明的源身份映射 blob 引用 |
| `blobs` | 按摘要排序去重的内容与存储表示 |

完整嵌套字段、枚举和必需项见严格 [V1 schema](../../../internal/workpackage/schema/manifest-v1.schema.json)、[V2 schema](../../../internal/workpackage/schema/manifest-v2.schema.json)。逻辑 key 与原始内容 SHA-256 构成引用，不能授予接收端权限。所有引用必须闭合；未知字段、重复 JSON key、不安全整数、缺失内容、未引用的 blob 用途均拒绝。空集合显式记录，相同内容合并 kinds 用途。

## 字节布局

```text
8 bytes magic | uint64 big-endian manifest length | UTF-8 JSON | ordered blobs
```

V1 magic 为 ASCII PIWORK1 加 LF，V2 为 PIWORK2 加 LF，均八字节。JSON 不压缩，没有逐 blob header、offset 表或尾随字节。blob 按清单的摘要升序排列，首项偏移为 `16 + manifestLength`。

V1 blob 只有 digest、size、kinds，存原始内容。V2 必需增加 encoding 和 storedSize：

```json
{"digest":"<64位小写SHA-256>","size":1000000,"kinds":["file"],"encoding":"zstd","storedSize":280000}
```

此片段仅说明字段，并非完整合法包。size/digest 始终描述解码后原始字节，storedSize 描述包内物理字节。raw 两种大小相等，空内容用 raw 且大小为零。一次成功试压后只保留更小的结果，否则选择 raw；编码失败整次导出失败。

zstd 项恰好包含一个普通 [Zstandard 帧](https://www.rfc-editor.org/rfc/rfc8878.html)，无字典、skippable frame、拼接帧或尾随数据。最大解码窗口为 8 MiB，包含 single-segment 语义。可选的帧内容长度须匹配 size，可选 checksum 须验证；读取时限制输出长度并检查原始 SHA-256。不同编码器可为同一内容生成不同压缩字节。

下项偏移增加 storedSize（V1 用 size）。物理包长度为 `16 + manifestLength + sum(storedSize)`；包 SHA-256 覆盖包括头、清单及编码内容的全部字节。镜像 config 身份和层 diff_ids 继续使用原始摘要。压缩等级属于内部均衡策略，不是清单字段或用户设置。

## 目录树、历史与完整性

树 blob 列举条目及原文件 blob 摘要；POSIX 字节路径编码为 base64 段。普通文件、空目录、权限、uid/gid、纳秒 mtime、symlink 原目标和同树硬链接遵循[存储规则](../work-storage/spec.md#requirement-preserve-complete-cold-snapshot-storage-without-dereferencing-user-links)。链接只作为数据保存，不跟随采集或恢复。未支持类型/元数据导致整包失败；security.selinux 由目标宿主策略负责。

全部保留 context、已准备包、固定镜像、配置修订、用户文件、缓存、依赖、业务数据、Session 和保留历史均包含。控制历史载荷字符串为不透明历史文本，受管身份字段按声明映射。私有历史必须符合精确支持的[历史 schema](../../../internal/workhistory/)及 [Memory 规则](../work-memory/spec.md)，历史请求不会恢复 live 执行权限。[合成 V1 完整包与正反例](../../../internal/workpackage/testdata/)可用于实现；V2 测试覆盖混合编码和标准 Zstd 互操作。

### 精确的 tree JSON

V1/V2 的 tree blob 使用同一结构。顶层恰好包含 `version`（整数 `1`）和 `entries`（非空数组）；缺少、未知或重复字段均拒绝。每个条目都必须包含以下六个公共字段：

| 字段 | 类型与约束 |
| --- | --- |
| `segmentsBase64` | 规范标准 Base64 字符串数组，每项编码一个原始 POSIX 路径段；`[]` 表示树根。 |
| `uid`、`gid` | 0 至 4294967295 的整数。 |
| `mode` | 0 至 4095 的整数（八进制 `07777`），仅含权限与特殊位，不含文件类型位。 |
| `mtimeNs` | Unix epoch 纳秒的 **JSON 字符串**，长度至多 32，匹配 `^-?(?:0|[1-9][0-9]*)$`；恢复时还须能由目标文件系统表示。 |
| `type` | 仅为 `directory`、`file`、`symlink` 或 `hardlink`。 |

在六个公共字段之外，按 type 恰好增加以下必需字段，不能混入其他变体的字段：

| `type` | 额外必需字段 |
| --- | --- |
| `directory` | 无。 |
| `file` | `blob`：原始文件 SHA-256，引用 manifest 中 kinds 包含 file 的 blob；`size`：非负安全整数，等于对应 blob 的原始 size，零值也必须显式写出。 |
| `symlink` | `targetBase64`：完整原始链接目标字节的规范标准 Base64，不是路径段数组。解码后非空、无 NUL、至多 4096 字节；绝对和悬空目标按数据保留。 |
| `hardlink` | `targetSegmentsBase64`：使用与 segmentsBase64 相同编码的路径段数组，指向同树中的 file 条目，可指向后面的条目；uid/gid/mode/mtimeNs 必须与目标完全一致，不能指向其他 hardlink、symlink、目录或另一棵树。 |

Base64 使用标准字母表与规范 padding，不使用 URL-safe 编码。路径段可以包含非 UTF-8 的原始字节，但不能为空、包含 NUL 或 `/`，也不能等于 `.` 或 `..`。用字节 `/` 连接解码后的段，路径至多 4096 字节、128 段。条目按**解码后拼接路径的无符号字节序**严格递增，不按 Base64 文本排序，路径唯一。第一项必须是根目录（`[]`）；非根条目的父路径必须已作为 directory 出现。文件内容通过摘要引用，不内嵌于树 JSON；hardlink 不额外累计文件内容。

以上为通用树规则；已准备 Pi Package 的树还须满足既有[包兼容规则](../online-pi-package-compatibility/spec.md)，包括更严格的依赖和链接约束。通过通用树校验不等于包制品整体有效。

下面是完整树示例：根目录、空文件 `a.txt`、其硬链接 `b.txt`，以及指向 a.txt 的符号链接 `link`。manifest 必须另行声明下列空文件 SHA-256 的 blob，原始 size 为 0、kind 包含 file；树自身的 UTF-8 JSON 字节单独计算摘要，作为 kind=tree 的另一个 blob。

```json
{
  "version": 1,
  "entries": [
    {
      "segmentsBase64": [],
      "uid": 10001,
      "gid": 10001,
      "mode": 493,
      "mtimeNs": "0",
      "type": "directory"
    },
    {
      "segmentsBase64": [
        "YS50eHQ="
      ],
      "uid": 10001,
      "gid": 10001,
      "mode": 420,
      "mtimeNs": "0",
      "type": "file",
      "blob": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "size": 0
    },
    {
      "segmentsBase64": [
        "Yi50eHQ="
      ],
      "uid": 10001,
      "gid": 10001,
      "mode": 420,
      "mtimeNs": "0",
      "type": "hardlink",
      "targetSegmentsBase64": [
        "YS50eHQ="
      ]
    },
    {
      "segmentsBase64": [
        "bGluaw=="
      ],
      "uid": 10001,
      "gid": 10001,
      "mode": 511,
      "mtimeNs": "0",
      "type": "symlink",
      "targetBase64": "YS50eHQ="
    }
  ]
}
```

其他结构化历史 blob 使用[原生 schema 清单](../../../internal/contracts/schemas.json)中既有的 `WorkControlHistorySchema` 与 `WorkSourceIdentityMapSchema`：`history.control` 引用前者，`history.sourceIdentityMap` 引用后者。context/service/operation 映射须与 manifest 的完整逻辑 key、源归属一致；普通归档载荷字符串保持不透明，只有受管身份字段进行映射。这些结构与 V1 共用，不是新增的 V2 内容模型。

## 限制与校验

物理包、解码包（`16 + manifestLength + sum(size)`）及恢复逻辑量各至多 100 GiB。恢复量跨树重复引用累计，镜像层去重累计，同树硬链接一次。manifest 及单份 JSON metadata 至多 64 MiB，metadata 累计至多 256 MiB；条目上限一百万，路径 4096 字节、深度 128。长度累计检查溢出，压缩不绕过原始 metadata 和恢复限制。

发布前检查 magic/版本一致、严格 schema、精确区间、原始哈希与完整闭包。非法内容返回 PACKAGE_INVALID，未知版本/编码返回 PACKAGE_FORMAT_UNSUPPORTED，超限返回 PACKAGE_LIMIT_EXCEEDED。离线 inspect 无执行副作用，只证明 integrity，不证明目标安装兼容。目标还须静态验证历史语义、模型、平台、权限和配额；检查和导入不执行包内代码。

## 搬迁与兼容

导出要求实际确认 stopped；导入发布新的 stopped Work，显式 Start 才建立新运行身份。active/desired 差异保留，恢复捕获内容不需原 registry 或重新安装依赖；目标匹配模型和外部服务仍为外部依赖。平台凭证不复制，用户自行保存在文件/历史中的秘密原样保留。

新版严格读取 V1/V2，新导出写 V2，旧版不能读 V2。已有 V1 文件和就绪快照不重写，下载重试保留原字节/摘要。同一原始内容在不同编码下不保证整包摘要相同。压缩缩小传输文件；安装内容占用和应用行为遵循原契约。

[V2 synthetic package / V2 合成包](../../../internal/workpackage/testdata/golden-v2.work) · [V2 boundary and interoperability cases / V2 边界与互操作用例](../../../internal/workpackage/compression_test.go)
