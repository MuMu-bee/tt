# 墨忆台迁移计划（MIGRATION-PLAN）

> 迁移策略：方案二。保留现有源码仓库中的 Obsidian 插件外壳与成熟 Dashboard，在原入口和用户路径下逐步替换核心服务。  
> 原则：先可观测、后切流；先读路径、后写路径；每阶段都能回滚。

## 1. 迁移目标

将现有 Agent Dashboard、Vault 扫描能力和 Hermes/RAG 基础能力，迁移为运行在 Obsidian 内的墨忆台工作台：

- Dashboard、侧边栏、命令和成熟快捷操作继续可用。
- RAG + LLM Wiki 作为 Hermes 的动态记忆库，由墨忆台管理。
- 墨忆台 Agent 负责管理/编排，不替代 Hermes 主 Agent。
- 关键词搜索优先，语义搜索兜底。
- 兼容旧 Vault/frontmatter，不要求一次性重命名或搬迁文件。
- frontmatter、标签、双向链接、格式标准化可以在配置范围内自动写入；小说资料默认只生成 proposal。
- proposal、审批和自动写入审计双重持久保存。

## 2. 迁移前置、现实基线与安全快照

### 2.1 当前代码与部署基线（必须先处理）

- 源码基线：现有插件源码仓库，包含 `src/`、`tests/`、`docs/` 和 `.git/`；迁移前应先建立基线提交并配置 GitHub remote。
- 部署基线：现有 Vault 的 `.obsidian/plugins/agent-dashboard` 目录，包含 `main.js`、`manifest.json`、`styles.css`，属于更旧或分叉的部署产物，不能反向作为源码基线。
- 部署产物仍发现 `hermes-memory-cli.py` 调用、硬编码 `vaultPath`/`indexDb`、`runMemoryCli`/`distill`/`Inbox` 逻辑；源码当前未发现 RAG/LLM Wiki 的直接耦合证据。
- 首个开发动作应是：以源码目录为唯一开发基线，建立首个基线提交，生成源码与部署产物的差异清单；禁止直接在部署目录的 `main.js` 上开发。
- 硬编码路径和旧 Hermes `child_process` 调用列为待拆分项；在没有明确契约和测试前，不把部署产物逻辑直接迁移到新核心。

在开始代码切换前完成：

1. 对现有插件源码、构建产物、设置 JSON 和用户数据做只读版本快照；记录提交号/文件 hash。
2. 复制一份脱敏测试 Vault，包含旧 frontmatter、无 frontmatter、小说资料、研究资料、链接和损坏文件样例。
3. 导出当前 Dashboard 配置、命令清单、快捷入口和现有任务状态。
4. 记录现有 Python Hermes CLI 的可用命令和测试结果；不假设 CLI 永远在线。
5. 检查目标目录和独立本地审计目录可写；确认 `_workbench/` 不会被旧同步规则误删。
6. 建立迁移开关：`legacy_dashboard`、`new_search`、`new_write_pipeline`、`hermes_adapter`、`background_research`，默认关闭新增写入能力。

## 3. 分阶段迁移

### 阶段 0：基线冻结与兼容层（M0）

**目标**：不改变用户行为，建立可观测基线。

**工作项**：

- 把现有 Dashboard 入口、侧边栏、命令和订阅/扫描功能包在稳定的 `LegacyDashboardAdapter` 后。
- 为 Vault 访问、索引、模型、联网和 Hermes CLI 建立 ports/adapters 接口。
- 为现有调用增加 `request_id`、结构化日志和错误状态，但不改变结果。
- 记录当前插件启动、Dashboard 渲染和旧扫描耗时作为基线。
- 只读解析旧 Markdown/frontmatter，未知字段原样保留。

**验收**：插件可正常加载；现有 Dashboard 操作通过回归；关闭全部新开关时行为与迁移前一致；旧 Vault 只读扫描无写入。

### 阶段 1：工作台壳与关键词搜索（MVP）

**目标**：在旧 Dashboard 中增加墨忆台入口和可靠的关键词检索。

**工作项**：

- 保留原 Dashboard 布局，将总览、聊天/搜索、整理队列、研究、记忆库状态和审计入口接入新导航。
- 复用或重构现有 FTS5/标题/路径/frontmatter 检索；结果提供 snippet、命中字段、原文打开动作。
- 增加索引健康状态、增量更新和全量重建；SQLite 是派生数据。
- 引入 Workbench Agent 的意图路由，但仅开放 search/read/status 工具，不开放写入和无限 terminal。
- 保留 Hermes 适配接口的空实现，Hermes 不可用时工作台仍可搜索。

**验收**：用户可从 Dashboard 完成关键词搜索和打开原文；旧 frontmatter、未知字段和无 frontmatter 文件均可读取；删除索引后可由 Vault 重建；UI 线程无全量扫描阻塞。

### 阶段 2：混合检索与低风险整理（V0.2）

**目标**：加入语义兜底和受限自动整理。

**工作项**：

- 在关键词结果不足、用户指定或配置触发时调用 bge-m3/兼容 embedding。
- 对搜索结果标记 `keyword` 或 `semantic` 来源，embedding 不可用时降级关键词。
- 新增 OrganizeService，仅实现 frontmatter、标签、双向链接、格式标准化四类白名单动作。
- 以目录/标签/单文件/排除规则限制范围；小说资料目录强制 proposal-only。
- 低风险动作在用户启用的范围内可自动 apply，但仍必须记录审计和前后 hash。
- 新增预览 diff 和逐文件失败状态。

**验收**：关键词优先、语义兜底可证明；白名单外正文修改被拒绝；个人记忆和配置允许的研究资料可自动整理；小说资料不发生自动写入；索引与 Vault 内容一致或显示待刷新。

### 阶段 3：Proposal、审批与安全写入（V0.3）

**目标**：将所有高风险修改纳入可追溯审批链路。

**工作项**：

- 实现 proposal 数据模型，保存目标文件、原始 hash、diff、原因、模型/provider、时间和过期状态。
- proposal、审批记录、自动写入审计同步保存到 Vault 受保护目录与独立本地目录。
- 实现单条/批量审批；批量仍逐文件校验 hash。
- apply 前重新读取文件并校验 hash、范围、动作白名单和 proposal 状态。
- 使用临时文件 + 原子替换；完成后刷新索引并写双重审计。
- 对双写一端失败、索引刷新失败、文件冲突提供补偿和回滚。

**验收**：修改文件后 apply 必须变成 conflict 且原文不变；审批后能可靠写入；插件重启后待审批 proposal 可恢复；审计可按 request_id 查询；双写失败显示 pending-compensation 而不是成功。

### 阶段 4：研究、动态记忆发布和小说资料保护（V0.4）

**目标**：支持后台研究，并让 Hermes 可消费版本化动态记忆。

**工作项**：

- 研究任务进入 worker，支持暂停、重试、取消和后台运行。
- 记录 provider、URL、抓取时间、引用片段、置信度、外发文件/片段 hash 和响应摘要。
- 研究结果写入正式区遵循目录策略；小说资料无论来源都只生成 proposal。
- 实现 MemoryPublishService 和 HermesAdapter：生成版本、发布、健康检查、回滚。
- 明确 Hermes 读取/同步协议；适配器故障不影响工作台搜索和整理。

**验收**：联网研究不阻塞 Obsidian UI；每个外发请求有审计；研究资料来源可追溯；Hermes 能读取已发布快照或查询接口；发布失败可重试/回滚；墨忆台 Agent 不进入 Hermes 主对话。

### 阶段 5：主动巡检与工作内容编排（V0.5）

**目标**：在核心读写安全稳定后，增加后台巡检和可控编排。

**工作项**：

- 定时扫描索引积压、断链、缺失元数据、研究任务和待办。
- 将 GitHub/订阅/待办等既有成熟功能通过统一任务协调器接入。
- 支持主动研究建议、自动归档建议和批量 proposal，但保留目录策略与人工审批。
- 为 Workbench Agent 增加多轮工具调用；每个工具继承 request_id、范围、provider 和审批权限。
- 增加历史审计、健康状态、补偿队列和管理员设置。

**验收**：定时任务可暂停/取消/重试；后台任务不阻塞 UI；自动生成建议不越权写入；既有 Dashboard 功能无回归；完整审计可追溯；Hermes 动态记忆发布可回滚。

## 4. 保留、重构、移除清单

### 4.1 保留（兼容优先）

- Obsidian 插件入口、manifest、启动生命周期。
- 现有 Dashboard 总览布局、侧边栏和已验证快捷操作。
- 订阅抓取、Vault 扫描以及已稳定的展示组件。
- Hermes memory CLI 已有的 frontmatter、脱敏、FTS5、bge-m3、语义搜索、inbox/distill/review/merge/link repair/trust 能力，先通过适配器调用。
- 旧 Vault 文件、目录、frontmatter 字段和用户设置。
- 现有 Python 编译、Node 语法和 Hermes 回归测试。

### 4.2 重构

- 将 Dashboard 直连 child_process/CLI 的调用改为 `HermesAdapter`、`IndexAdapter` 等端口。
- 将搜索统一为关键词优先、语义兜底，并提供降级状态。
- 将写入统一收敛到 Organize → Proposal/Approval → Write → Index → Audit 流程。
- 将长任务移入 worker 和 `TaskCoordinator`。
- 将研究、模型调用、联网和外发审计模块化。
- 新增双重审计持久化、补偿、回滚和冲突保护。
- 增加 MemoryPublishService，明确 RAG + LLM Wiki 与 Hermes 的读取关系。

### 4.3 移除或默认禁用

- Dashboard/Agent 绕过服务层直接写 Vault 的路径。
- 没有目录白名单、没有 hash 校验的自动改写。
- 无审计的静默网络外发和无来源研究入库。
- MVP 中无限制的 `run_terminal`。
- 将墨忆台 Agent 设计成 Hermes 替代品的代码和文案。
- 将 SQLite/embedding 作为不可恢复事实源的逻辑。
- 小说资料目录的默认自动写入。

## 5. 数据迁移与兼容规则

1. **文件不迁移优先**：旧 Markdown 原地读取；新字段只有在用户启用整理规则后才 proposal/apply。
2. **索引可重建**：旧索引按版本标记；新索引在旁路目录构建完成后切换，失败则继续使用旧索引。
3. **frontmatter 保真**：保留未知字段、注释和原有值；解析异常的文件进入人工队列，不自动修复正文。
4. **审计补建**：迁移前已有写入无法补造完整 proposal；从迁移时刻开始所有新操作必须有 request_id 和双写审计。
5. **proposal 版本化**：proposal 记录 schema_version；升级时提供只读兼容和显式迁移器，不覆盖原记录。
6. **Hermes 快照隔离**：先生成新的发布版本并健康检查，再切换 Hermes 的读取指针；失败保留旧版本。

## 6. 回滚策略

### 6.1 功能开关回滚

任何阶段出现严重回归时，按顺序关闭 `background_research`、`hermes_adapter`、`new_write_pipeline`、`new_search`，最后启用 `legacy_dashboard`。关闭开关不会删除新产生的 proposal、审计或索引数据，便于诊断。

### 6.2 文件写入回滚

每次 apply 保存 before/after hash，以及足以恢复的快照或补丁。回滚操作仍通过权限检查并写入 `rollback` 审计；若当前 hash 已被再次修改，必须停止并生成冲突，不得覆盖用户新内容。

### 6.3 索引回滚

索引按 schema/version 存放。新索引旁路构建并通过校验后原子切换；切换失败或查询异常时指回旧索引。任意索引均可从 Vault 全量重建。

### 6.4 Hermes 发布回滚

动态记忆发布使用不可变版本号。新版本发布失败继续使用上一健康版本；发现内容异常时将 Hermes 读取指针回滚到上一版本，并保留失败版本和审计。

### 6.5 数据损坏处理

Vault 审计与本地审计不一致时，以内容 hash 和较完整记录为基础进入补偿队列；不自动删除任一端。无法判断时导出冲突报告交由用户处理。

## 7. 迁移完成定义

- 所有 P0 读路径和写安全验收通过。
- 旧 Dashboard 核心路径和既有测试保持通过。
- 旧 Vault 无需搬迁即可搜索、索引和打开。
- 任何自动整理都受白名单、范围、hash 和审计约束。
- 小说资料默认 proposal-only。
- proposal、审批和自动写入审计可在重启后从两端恢复。
- Hermes 能通过已确认的读取/同步契约读取动态记忆，且墨忆台 Agent 未接管 Hermes 主对话；具体使用快照、文件、CLI 还是 API 必须以契约测试结果为准。
