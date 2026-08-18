# 墨忆台 Memory Workbench

Obsidian 插件，为知识库提供只读索引、关键词优先搜索、整理计划 Proposal/Approval/Audit 基础安全写入链路和持久化恢复能力。

> **当前状态快照（2026-08-17）**：`main` 当前 HEAD 为 `edbb9b2`（PR #2 已合并）。`npm test` 当前为 101/101；`npm run build` 和 TypeScript 检查通过；真实 Obsidian 桌面 smoke test 尚未执行。最新 Release `0.1.0` 的 tag 为 `3f7ffc2`，早于当前 `main`。
>
> 本 README 只描述当前实现摘要。历史基线和目标设计文档不等同于当前状态，详见 [`AGENT-HANDOFF-PROMPT.md`](docs/inkmemory/AGENT-HANDOFF-PROMPT.md)。

## 当前版本

- **版本号**：0.1.0
- **桌面专用**：`isDesktopOnly: true`（暂不支持移动端）
- **内部包名**：`agent-dashboard`（历史遗留，产品已更名为墨忆台）
- **分支**：`main`（PR #1、PR #2 均已合并）
- **基线提交**：`5586f4a feat: add v0.2 hybrid search and safe writes`（后续版本均在其上迭代）

## 核心能力

### 只读索引与搜索

- 基于 Vault Markdown 构建内存索引
- 关键词优先搜索（标题、路径、frontmatter、标签、正文）
- 可选 semantic fallback（默认关闭）
- 搜索结果返回原文路径和片段

### 整理计划与安全写入

- 四类整理规则：`frontmatter-add`、`tag-add`、`bidirectional-link-add`、`format-normalize`
- `bidirectional-link-add` 仅在笔记 frontmatter 设置了 `related` 字段时生成（指向 related 笔记，自链接自动跳过）
- 所有整理规则默认关闭，需用户在设置中开启；设置改动即时生效，无需重载插件
- 整理计划生成真实 before/after/diff，不含虚假变更
- Proposal 持久化到 Vault 内 JSONL 文件

### Proposal / Approval / Audit 基础链路

```
OrganizePlan
  -> ProposalStore (JSONL 持久化)
  -> 单条 approve / reject
  -> apply 前重读文件并校验 base_hash
  -> fiction / unknown 零写入拦截
  -> WriteService
  -> WritePort / Obsidian adapter
  -> 索引刷新
  -> AuditStore (Vault JSONL + 插件数据目录镜像)
```

### 持久化恢复

- 插件启动时 `await` 恢复 Proposal、Approval、Audit
- 损坏 JSONL 行跳过，不阻断其他记录恢复
- 恢复失败进入 degraded 状态
- degraded 状态阻断审批和写入，但 Dashboard 和搜索仍可用
- 重启恢复不会自动 apply
- **持久化现状**：Proposal/Approval 为 Vault 内 JSONL 单端；Audit 具备 Vault + 插件数据目录镜像路径。正常审计失败路径会标记为 `pending-compensation` 并提供重试入口，但镜像恢复、失败重试保留 pending 和同文件并发写仍是已知缺口

## 安全边界

| 项目 | 状态 |
|------|------|
| Vault Markdown 唯一事实源 | 是 |
| Proposal apply 核心 Markdown 写入经过 WriteService -> WritePort | 是 |
| 所有 UI 和业务服务都不直接调用 Vault 写入 API | 否；日报、研究/图片报告、AgentAction 和回滚仍有直写路径 |
| fiction / unknown proposal-only | 是 |
| hash conflict 零写入 | 是 |
| 正常恢复失败会降级并阻断写入 | 是；异常抛错路径仍需补强 |
| 默认写入开关关闭 | 是 |
| Hermes CLI | 未接入 |
| child_process / spawn / terminal | 未接入 |

### Feature Flags 默认值

| Flag | 默认值 |
|------|--------|
| `semantic_search` | `false` |
| `semantic_fallback` | `false` |
| `new_write_pipeline` | `false` |
| `organize_auto_apply` | `false` |
| `organize.frontmatter` | `false` |
| `organize.tags` | `false` |
| `organize.links` | `false` |
| `organize.format` | `false` |
| `fiction_proposal_only` | `true` |
| `memory.enabled` | `false` |
| `memory.captureL0` | `false` |
| `memory.autoExtract` | `false` |
| `memory.autoRecall` | `false` |
| `memory.recallDepth` | `l3` |

> 记忆系统的 4 层架构、存储布局与调度语义见 [`docs/memory-architecture.md`](docs/memory-architecture.md)。

### 持久化文件路径

| 类型 | 路径 | 格式 |
|------|------|------|
| Proposal | `_workbench/proposals/records.jsonl` | JSONL |
| Approval | `_workbench/approvals/records.jsonl` | JSONL |
| Audit 主记录 | `_workbench/audit/events.jsonl` | JSONL |
| Audit 镜像 | 插件数据目录 `audit/events.jsonl` | JSONL |

这些文件为 `.jsonl` 格式，不会被插件的 Markdown 索引和搜索收录。

## 安装与构建

### 开发环境

```bash
npm install
npm run dev    # 监听模式编译
```

### 生产构建

```bash
npm run build  # tsc 类型检查 + esbuild 打包
```

构建产物（输出到 `deploy/` 目录）：
- `deploy/main.js` — 插件主入口
- `manifest.json` — 插件清单
- `styles.css` — 样式文件

### 手动安装

将 `deploy/main.js`、`manifest.json`、`styles.css` 复制到 Vault 的 `.obsidian/plugins/agent-dashboard/` 目录，然后在 Obsidian 设置中启用插件。

### 测试

```bash
npm test       # 全量测试（含持久化集成测试）
npm run lint   # ESLint 检查
```

## 技术栈

- TypeScript + esbuild
- Obsidian Plugin API (minAppVersion: 1.8.0)
- 纯前端，无后端依赖
- Node.js 20+（开发环境）

## 项目结构

```
src/
  main.ts                          # 插件入口
  settings.ts                      # 设置面板
  application/
    contracts.ts                   # 数据结构和接口定义
    featureFlags.ts                # Feature flags
    persistenceContracts.ts        # 持久化状态契约
    requestContext.ts              # 请求上下文
  domain/
    vault-document.ts              # Vault 文档解析
  services/
    runtimeComposition.ts          # Runtime composition root
    searchService.ts               # 搜索服务
    indexLifecycleService.ts       # 索引生命周期
    organizeService.ts             # 整理计划生成
    writeService.ts                # 受控写入服务
    proposalService.ts             # Proposal 服务
    approvalService.ts             # 审批服务
    proposalApplyService.ts        # Apply 服务（含 hash 校验）
    persistenceGate.ts             # 持久化状态门控
    auditService.ts                # 审计服务
    scopeService.ts                # 范围控制
  adapters/
    obsidianVaultReader.ts         # 只读 Vault 适配器
    obsidianWritePort.ts           # Obsidian 写入适配器
    obsidianJsonlStorage.ts        # Vault JSONL 存储
    jsonlProposalStore.ts          # Proposal JSONL 持久化
    jsonlApprovalStore.ts          # Approval JSONL 持久化
    jsonlAuditStore.ts             # Audit JSONL 持久化
    jsonlAuditSink.ts              # AuditSink 适配
    in-memory-vault-index.ts       # 内存索引
    unavailableSemanticSearch.ts   # 语义搜索降级
  ports/
    proposalPort.ts                # Proposal 抽象边界
    approvalPort.ts                # Approval 抽象边界
    auditStore.ts                  # Audit 抽象边界
    writePort.ts                   # 写入抽象边界
    persistencePort.ts             # 持久化恢复抽象
  views/
    AgentDashboardView.ts          # Dashboard 视图
  utils/
    sha256.ts                      # 跨平台 SHA-256
tests/
  *.test.ts                        # 全量测试
```

## 已知限制

- `pending-compensation` 支持：审计落盘失败/镜像失败 → 标记待补偿 → 工作台重试；Proposal/Approval 尚无补偿队列
- Proposal/Approval 持久化为 Vault 单端；仅 Audit 双端
- JSONL restore 失败后的重试、同文件并发写串行化、Approval 并发 CAS 仍需补强
- `WriteService` 当前未完整验证 `scope_snapshot`；Proposal apply 未持久化原始 scope snapshot
- semantic 索引尚未按内容 hash 增量更新，tag scope 和 includes 边界仍需补强
- 后台研究任务不支持排队/暂停（可取消与重试）
- Hermes 记忆发布（MemoryPublishService）尚未接入 UI/命令
- 桌面 smoke test 尚未在真实 Obsidian 环境中运行
- 当前 workflow 只在 tag push 时发布，`main`/PR 没有 CI 门禁
- 移动端不支持

## 许可证

MIT
