# Spec Delta

## MODIFIED Requirements

### Requirement: Manage the Core catalog separately from default selection

**Identifier:** PKG-004

仅 operator 和已启用管理员 SHALL 通过各自受保护的管理 API 管理 Core package catalog；普通 user 仍只能使用原有 enabled catalog 只读能力。普通 install SHALL 发布 enabled=true 且不加入默认；install --default SHALL 原子发布并追加默认集合，保留其他默认项。默认选择最多 64 个唯一 enabled 包；显式空集合 SHALL 有效。Core update SHALL 保留 enabled 和默认引用；默认引用中的包 disable/remove SHALL 返回 `PI_PACKAGE_IN_DEFAULTS`，先移出默认后才能操作。Core 更新/禁用/移除 SHALL NOT 修改已创建 Work 的任何副本。

用户只读 catalog SHALL 只公开 enabled 包；operator 及通过管理 API 访问的管理员 SHALL 能看到 enabled/disabled 和 isDefault。列表 SHALL 按 name 的 UTF-8 字节顺序返回，不返回制品文件内容、宿主路径、secret 或内部 digest。

Core 启动 SHALL 允许将原内置且启用的旧 piwork-brain 更新为当前内嵌 package；这是内置包初始化入口的有限延续，不增加外部写权限或普通包自动更新。该更新 SHALL 保留默认引用和全部 Work 副本，沿用现有隔离准备、Core package 互斥、原子发布与引用保留规则。

#### Scenario: Install without changing defaults
- **WHEN** operator 安装 tools 且没有 --default
- **THEN** tools 在 enabled catalog 可发现，已有默认集合及新 Work 的默认选择不变

#### Scenario: Atomically install a default
- **WHEN** 默认已有 a、b，operator 成功安装 c --default
- **THEN** catalog 和默认集合一起提交为 a、b、c；安装失败时两者均不增加 c

#### Scenario: Protect a default reference
- **WHEN** operator 尝试 disable/remove 一个仍为默认的包
- **THEN** 返回 PI_PACKAGE_IN_DEFAULTS，包和默认集合保持不变

#### Scenario: Future Works observe the new head
- **WHEN** A 捕获 tools v1 后 Core 将 tools 更新为 v2，再创建 B
- **THEN** A 的 desired/active 仍为自己的 v1，B 获得 v2

#### Scenario: 管理员和 operator 共享同一 Core 库
- **WHEN** 管理员安装或修改 Core package 后 operator 查询，或反向执行
- **THEN** 双方观察到同一 catalog/defaults，并共同遵守 Core package 并发门禁，已有 Work 副本不变

#### Scenario: 内置脑包更新只作用于 Core
- **WHEN** Core 启动更新原内置旧脑包
- **THEN** 只切换 Core catalog 的已验证 head，既有 Work desired/active 不变，管理员替换、禁用或移除的包不被覆盖或重新安装

