# 墨忆台技术设计（TECHNICAL-DESIGN）

> **文档性质：目标技术设计/历史基线。** 这里的双端持久化、CAS、完整写入门禁等内容是设计要求，不等同于当前实现已经闭环；当前状态见 [`AGENT-HANDOFF-PROMPT.md`](AGENT-HANDOFF-PROMPT.md)。

> 版本：方案二基线（2026-08-07）  
> 设计原则：保留现有源码仓库中的 Obsidian 插件外壳和成熟 Dashboard，在其内部重构核心。  
> 事实源：Vault 中的 Markdown；SQLite、FTS5、向量索引和模型输出均为可重建派生数据。

## 1. 设计目标与边界

墨忆台运行在 Obsidian 内，负责管理用户的动态记忆库（RAG + LLM Wiki）和工作内容。它的 Agent 只负责工作台管理、编排、检索、整理、研究和审批，不取代 Hermes，不接管 Hermes 主对话或主推理。

技术设计需要同时满足：

- 旧插件入口、命令、侧边栏和 Dashboard 可继续启动，用户无需更换工作习惯。
- 关键词搜索优先，结果不足或用户明确要求时再进行语义搜索兜底。
- 读取旧 Vault、旧 frontmatter 和未知字段不需要迁移；新字段按兼容方式逐步补充。
- 低风险整理只允许白名单动作：补 frontmatter、补标签、补双向链接、格式标准化；小说资料目录默认只能 proposal + 审批。
- 任何高风险或超出白名单的修改都不能直接落盘。
- proposal、审批、自动写入审计双重持久化到 Vault 受保护目录和独立本地目录。
- 后台联网研究不阻塞 Obsidian UI，且记录外发范围、provider、时间和来源。

## 2. 目标部署形态

### 2.1 进程与运行边界

```text
Obsidian Plugin（TypeScript）
├── UI/Workspace：复用现有 Dashboard 与侧边栏
├── Workbench Agent：意图识别、编排、权限检查、任务状态
├── Domain Services：搜索、索引、整理、proposal、研究、审计
├── Adapters：Vault、Hermes、模型、网络 provider、定时器
└── Worker Bridge：将 FTS/embedding/全量扫描等长任务移出 UI 线程

Hermes（独立主 Agent）
└── 通过 Memory Adapter 读取已发布的 RAG + LLM Wiki 动态记忆

Vault Markdown
└── 唯一事实源；记忆、工作内容、研究资料和审计副本均可追溯
```

插件内服务必须使用依赖注入的适配器，不在业务服务中直接调用 Node `child_process`、HTTP 客户端或 Obsidian 全局对象。这样可在桌面环境、测试环境和 Hermes 不可用时保持可替换与降级。

### 2.2 推荐目录边界

在现有插件源码中采用按职责拆分，实际目录名可依据旧项目风格映射：

```text
src/
├── main.ts                         # 插件入口，负责组装依赖与注册视图
├── data/
│   └── dashboardTypes.ts           # Dashboard 数据类型与默认配置
├── application/
│   ├── contracts.ts                # Proposal/Approval/Audit/搜索契约
│   ├── featureFlags.ts             # 功能开关
│   ├── persistenceContracts.ts     # 持久化状态契约
│   ├── requestContext.ts           # 请求上下文
│   ├── githubTracker.ts            # GitHub API 解析（纯函数）
│   ├── modelCompletions.ts         # 云端模型请求构造
│   ├── vectorMath.ts               # 向量计算工具
│   └── visionCompletions.ts        # 视觉模型请求构造
├── domain/
│   ├── vault-document.ts           # Markdown 文档解析
│   └── keyword-search.ts           # 关键词搜索算法
├── ports/
│   ├── modelPort.ts                # 模型接口
│   ├── indexPort.ts                # 索引接口
│   ├── vaultReaderPort.ts          # 只读 Vault 接口
│   ├── semanticSearchPort.ts       # 语义搜索接口
│   ├── proposalPort.ts             # Proposal 接口
│   ├── approvalPort.ts             # Approval 接口
│   ├── auditStore.ts               # 审计接口
│   ├── writePort.ts                # 写入接口
│   └── persistencePort.ts          # 持久化接口
├── adapters/
│   ├── in-memory-vault-index.ts    # 内存索引适配器
│   ├── obsidianVaultReader.ts      # Obsidian Vault 只读适配器
│   ├── obsidianWritePort.ts        # Obsidian 写入适配器
│   ├── obsidianJsonlStorage.ts     # Vault JSONL 存储适配器
│   ├── jsonlProposalStore.ts       # Proposal JSONL 持久化
│   ├── jsonlApprovalStore.ts       # Approval JSONL 持久化
│   ├── jsonlAuditStore.ts          # Audit JSONL 持久化
│   ├── jsonlAuditSink.ts           # 审计写入适配器
│   ├── ollamaEmbedding.ts          # Ollama 嵌入适配器
│   ├── ollamaSemanticSearch.ts     # Ollama 语义搜索适配器
│   ├── openAiModel.ts              # 云端模型适配器
│   └── unavailable*.ts             # 安全降级适配器
├── services/
│   ├── runtimeComposition.ts       # Composition root
│   ├── searchService.ts            # 搜索服务（关键词优先）
│   ├── indexLifecycleService.ts    # 索引生命周期管理
│   ├── organizeService.ts          # 整理计划生成
│   ├── proposalService.ts          # Proposal 服务
│   ├── approvalService.ts          # 审批服务
│   ├── proposalApplyService.ts     # Apply 服务（hash 校验）
│   ├── writeService.ts             # 受控写入服务
│   ├── auditService.ts             # 审计服务
│   ├── persistenceGate.ts          # 持久化降级门禁
│   ├── dashboardService.ts         # Dashboard 数据加载
│   ├── dashboardMath.ts            # Dashboard 数学工具
│   ├── agentActionService.ts       # 快捷操作业务逻辑
│   ├── projectTracker.ts           # GitHub 项目追踪
│   ├── projectReportService.ts     # AI 项目报告生成
│   ├── visionService.ts            # 图片理解服务
│   ├── feedService.ts              # Feed 服务
│   ├── cacheStore.ts               # 缓存存储
│   └── vaultScanner.ts             # Vault 扫描服务
├── ui/
│   ├── ImageUnderstandModal.ts     # 图片理解弹窗
│   └── InboxIngestModal.ts         # 收件箱导入弹窗
├── views/
│   ├── AgentDashboardView.ts       # 主视图（8 页面切换）
│   └── proposalViewState.ts        # Proposal UI 状态纯函数
└── utils/
    └── sha256.ts                   # 跨平台 SHA-256
```

现有 Python Hermes memory CLI 若继续使用，必须封装在 `HermesAdapter` 或 `IndexAdapter` 后面；业务层不能依赖 CLI 的命令行字符串。Hermes CLI 是可选适配器，不是墨忆台启动的硬依赖。

## 3. 模块职责与明确边界

| 模块 | 负责 | 不负责 |
|---|---|---|
| `DashboardView` | 总览、快捷入口、订阅抓取等现有功能展示 | 直接修改 Vault、直接调用模型 |
| `WorkbenchAgent` | 将用户请求转成受限工具计划；展示确认 | Hermes 主对话、无限工具调用、绕过审批 |
| `SearchService` | 关键词检索、阈值判断、语义兜底、结果排序 | 修改原笔记、自动归档搜索结果 |
| `IndexService` | 增量/全量索引、FTS5、embedding 状态 | 把索引当事实源 |
| `OrganizeService` | 识别白名单低风险问题，生成可执行变更 | 修改正文含义、越过目录策略 |
| `ProposalService` | 保存 proposal、diff、原始 hash、过期状态 | 直接 apply |
| `ApprovalService` | 单条/批量审批、权限和范围检查 | 改写 proposal 内容 |
| `WriteService` | hash 校验、原子写入、索引刷新、审计 | 生成未经审批的变更 |
| `ResearchService` | 后台联网、来源和外发记录、研究资料草稿 | 无来源的静默写入 |
| `AuditService` | 双重保存、request_id 查询、失败补偿 | 删除审计历史 |
| `MemoryPublishService` | 生成版本化动态记忆快照、发布/回滚 | 代替 Hermes 推理 |
| `HermesAdapter` | 为 Hermes 提供读取/同步协议 | 管理 Hermes 主会话 |

## 4. 数据模型与契约

### 4.1 统一标识和状态

每次用户操作、后台任务、模型调用、写入和 Hermes 同步都生成 `request_id`（UUID）。文件以规范化 Vault 相对路径标识。所有时间使用 ISO 8601 UTC 保存，UI 可本地化展示。

```ts
interface RequestContext {
  request_id: string;
  actor: 'user' | 'workbench-agent' | 'background-task';
  created_at: string;
  parent_request_id?: string;
}

type ProposalStatus =
  | 'pending' | 'approved' | 'rejected' | 'applied'
  | 'conflict' | 'expired' | 'failed';
```

### 4.2 兼容的笔记与索引记录

解析器必须保留原始 frontmatter 字段和未知字段，不把缺字段直接视为错误。新增字段使用可选命名空间，首版推荐：`memory.*`、`source.*`、`workbench.*`；补写前必须生成 diff。

```ts
interface NoteRecord {
  path: string;                 // Vault 相对路径
  title: string;
  raw_hash: string;             // 原文 hash
  frontmatter: Record<string, unknown>;
  tags: string[];
  links: string[];
  body_preview?: string;
  modified_at: string;
  zone: 'memory' | 'work' | 'research' | 'fiction' | 'system';
}

interface SearchQuery {
  query: string;
  limit: number;
  mode?: 'keyword' | 'hybrid' | 'semantic';
  scope?: SearchScope;
}

interface SearchResult {
  path: string;
  title: string;
  score: number;
  matched_fields: string[];
  snippet: string;
  source: 'keyword' | 'semantic';
  raw_hash: string;
}
```

### 4.3 Proposal、审批和审计契约

```ts
type ChangeKind =
  | 'frontmatter-add' | 'tag-add' | 'bidirectional-link-add'
  | 'format-normalize' | 'research-import';

interface Proposal {
  proposal_id: string;
  request_id: string;
  target_path: string;
  target_zone: NoteRecord['zone'];
  change_kind: ChangeKind;
  base_hash: string;
  patch: string;                 // 可展示、可重放的 unified diff
  reason: string;
  model?: { provider: string; name: string };
  created_at: string;
  expires_at?: string;
  status: ProposalStatus;
  requires_approval: boolean;
}

interface ApprovalRecord {
  approval_id: string;
  proposal_id: string;
  request_id: string;
  decision: 'approve' | 'reject';
  actor: 'user';
  decided_at: string;
  note?: string;
}

interface WriteAudit {
  audit_id: string;
  request_id: string;
  proposal_id?: string;
  target_path: string;
  before_hash: string;
  after_hash?: string;
  action: ChangeKind | 'rollback';
  result: 'success' | 'conflict' | 'failed' | 'pending-compensation';
  error_code?: string;
  created_at: string;
}
```

### 4.4 搜索契约

1. 先查询标题、路径、frontmatter、标签和正文的 FTS5 索引。
2. 当结果数低于 `keyword_min_results`、最高分低于 `keyword_min_score`，或用户指定语义模式时，再调用 embedding 索引。
3. 关键词命中必须优先展示；混合模式使用可配置权重，结果注明来源。
4. embedding/SQLite 不可用时降级为关键词；两者都不可用时显示明确错误，不修改 Vault。
5. 搜索结果只携带最小必要片段，点击后由 Obsidian 打开原文。

### 4.5 Hermes 读取/同步契约

RAG + LLM Wiki 是 Hermes 的动态记忆库。墨忆台将已索引且满足发布策略的笔记生成版本化快照，或通过适配器提供查询接口。建议最小协议：

```ts
interface MemoryAdapter {
  publish(input: { version: string; changed_paths: string[] }): Promise<{
    version: string; published_at: string; item_count: number;
  }>;
  query(input: { query: string; limit: number; version?: string }): Promise<SearchResult[]>;
  rollback(version: string): Promise<void>;
  health(): Promise<{ available: boolean; detail?: string }>;
}
```

- Hermes 只读取动态记忆，不获得墨忆台审批权限。
- 墨忆台 Agent 不接管 Hermes 主对话、主推理和会话历史。
- Hermes 适配器不可用时，Vault、搜索、整理队列和审计仍正常工作。
- 发布版本记录包含 `request_id`、版本号、路径集合、索引摘要和失败原因，可回滚到前一个版本。

## 5. 关键数据流

### 5.1 Vault 到动态记忆库

```text
Vault 文件变更
  -> VaultAdapter 读取 Markdown/frontmatter
  -> 计算 raw_hash、解析 zone
  -> IndexService 更新 FTS5
  -> 可选 EmbeddingWorker 更新向量
  -> MemoryPublishService 生成版本快照
  -> HermesAdapter.publish（可选）
  -> 写入同步审计
```

索引更新失败不能改变 Vault 原文；任务状态必须标为待重试。全量重建可删除并重建 SQLite/向量库，不得删除 Markdown。

### 5.2 搜索到工作台 Agent

```text
用户输入
  -> WorkbenchAgent 判断意图与范围
  -> SearchService.keyword()
  -> 命中足够：返回关键词结果
  -> 命中不足：EmbeddingAdapter.semantic()
  -> 统一结果排序/去重
  -> UI 展示 snippet、来源、原文打开入口
```

Agent 只能获得搜索服务返回的脱敏/最小片段。需要全文研究时必须走网络外发策略和审计。

### 5.3 整理到安全写入

```text
扫描范围 + 规则
  -> OrganizeService 识别白名单动作
  -> fiction zone 或高风险动作：只生成 Proposal
  -> 低风险且目录策略允许：可自动 apply
  -> ProposalService 持久化 proposal（Vault + local）
  -> 用户审批（需要时）
  -> WriteService 重新读取当前文件
  -> 校验 path/scope/action/base_hash
  -> 写临时文件并原子替换
  -> 刷新索引
  -> AuditService 双写审计
```

## 6. 写入安全与失败处理

### 6.1 目录和动作策略

配置至少包含 `allowed_zones`、`proposal_only_zones`、`excluded_paths`、`allowed_change_kinds`、网络 provider 白名单和模型白名单。小说资料目录始终位于 `proposal_only_zones` 的默认值中；除非用户显式修改策略并确认，仍不允许自动写入。模型不得自行扩大范围。

### 6.2 Hash 与原子替换

apply 过程必须是不可跳过的顺序：

1. 读取当前文件并计算 `current_hash`。
2. 比对 proposal 的 `base_hash`；不一致则状态为 `conflict`，不写入。
3. 重新验证路径、目录、动作白名单和 proposal 未过期。
4. 将结果写入同目录临时文件并 fsync（平台能力允许时）。
5. 原子 rename/replace；失败时保留原文且记录错误。
6. 重新索引；索引失败标为 `applied-index-pending`，不能伪报完整成功。
7. 通过 AuditService 写入双重审计。

并发下使用单文件锁或队列串行化 apply。批量审批仍逐文件独立校验，某一文件冲突不能连带写入其他文件失败。

### 6.3 双重持久化和补偿

建议路径：

- Vault：`_workbench/proposals/`、`_workbench/approvals/`、`_workbench/audit/`。
- 独立本地目录：插件数据目录下的 `proposals/`、`approvals/`、`audit/`。

每条记录在两端使用同一 `request_id` 和内容 hash。写入一端成功、另一端失败时，状态为 `pending-compensation`，UI 提供重试；严禁静默丢弃。启动时执行一致性扫描，发现缺失记录时从完整端补偿并留下审计。

### 6.4 网络外发与研究

后台研究运行在 worker 中，必须：

- 通过 provider 白名单和网络开关；记录 provider、模型、URL、抓取时间、请求参数摘要。
- 记录实际外发文件路径/片段 hash、敏感信息检查结果和用户确认（若策略要求）。
- 研究结果保留引用片段、来源 URL、抓取时间、置信度和原始响应摘要。
- 导入正式区时根据目录策略生成 proposal 或执行低风险自动写入；小说资料只能 proposal。
- 网络超时、部分结果和取消都可恢复，不能阻塞 UI。

## 7. 任务、并发与可观测性

`TaskCoordinator` 为每个长任务保存 `queued/running/paused/cancelled/succeeded/failed` 状态、进度、重试次数、错误码和 `request_id`。全量扫描、embedding、联网研究不在 UI 线程同步执行。所有日志必须结构化并避免直接写入敏感正文；审计保留必要的路径与 hash。

最低监控指标：关键词搜索耗时、语义兜底次数、索引积压、proposal 待审批数、hash 冲突数、双写补偿数、研究失败数和 Hermes 同步健康状态。

## 8. 测试与验收策略

- 单元测试：frontmatter 兼容解析、白名单规则、diff 生成、hash 冲突、审计幂等、搜索降级。
- 集成测试：旧 Vault 扫描、增量/全量索引、审批 apply、双写补偿、研究导入、Hermes 适配器不可用。
- UI 测试：Dashboard 启动、搜索→打开原文、proposal 审批/拒绝、冲突提示、任务暂停/重试。
- 回归测试：保留现有 Python 编译、Node 语法、Hermes 既有回归测试；新增旧 frontmatter、小说资料保护和重启恢复场景。

发布门槛：任何写入安全测试失败不得发布；索引丢失必须能从 Vault 重建；Hermes 不可用不得阻塞工作台基本功能。

## 9. UI 设计原则

### 9.1 CSS 策略

墨忆台不使用自定义 CSS 变量，而是直接使用 Obsidian 原生 CSS 变量：

| 用途 | 变量 | 说明 |
|---|---|---|
| 主背景 | `--background-primary` | 跟随 Obsidian 主题 |
| 侧栏背景 | `--background-secondary` | 自动适配深浅色 |
| 主文字 | `--text-normal` | 跟随主题 |
| 次要文字 | `--text-muted` | 降级信息 |
| 强调色 | `--interactive-accent` | 按钮、高亮 |
| 边框 | `--background-modifier-border` | 卡片分隔 |
| 阴影 | `--shadow-s` / `--shadow-m` | 卡片层级 |

采用此策略的原因：
- 插件自动跟随用户当前使用的任何 Obsidian 主题（如 Cupertino、Minimal 等）
- 无需维护两套主题逻辑（浅色/深色）
- 用户更换主题后插件自动适配

### 9.2 页面架构

墨忆台使用 `showPage()` 机制实现多页面切换，共 8 个页面：

| 导航项 | 页面内容 | 状态 |
|---|---|---|
| 总览 | 欢迎区 + 指标 + 快捷操作 + 双栏网格（知识星图预览/最近更新/生产动态/健康度）+ 热力图 | ✅ 已实现 |
| 知识库 | 关键词搜索 + 语义搜索 | ✅ 已实现 |
| 知识星图 | Canvas 力导向图 + 搜索 + 图谱透镜筛选 | ✅ 已实现 |
| 任务与计划 | 整理工作台 + 任务列表 | ✅ 已实现 |
| 项目追踪 | GitHub 项目动态 | ✅ 已实现 |
| 每日热点 | 热点聚合卡片 | ✅ 已实现 |
| 对话 | 占位 | ✅ 已实现 |
| 设置 | 跳转 Obsidian 设置 | ✅ 已实现 |

### 9.3 设计参考

- **Apple 风格**：参考 Obsidian Cupertino 主题（1222★）的设计模式
- **卡片布局**：参考 Card Board 插件（635★）的卡片式设计
- **原生集成**：参考 Day Planner 插件（2694★）使用侧边栏/状态栏等原生位置
