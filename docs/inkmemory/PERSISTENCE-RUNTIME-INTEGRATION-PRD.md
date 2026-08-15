# Persistence Runtime Integration 基线 PRD

> 基线日期：2026-08-09  
> 仓库：`E:/TT/workbuddy工作/2026-08-08-12-17-00`  
> 分支：`feat/memory-workbench-foundation`  
> 本文仅记录运行时持久化接入基线与验收边界，不包含业务源码改动。

## 1. 项目信息

- **Project Name**：`persistence_runtime_integration`
- **Language**：简体中文
- **Programming Language**：TypeScript（Vite + React + MUI + Tailwind CSS 默认约定不适用于当前 Obsidian 插件；本仓库实际为 Obsidian Plugin + TypeScript + esbuild）
- **原始需求复述**：核对 Persistence Runtime Integration 真实基线，确认 ProposalStore、ApprovalStore、AuditStore 的运行时实现，Jsonl/持久化 adapter 是否存在，插件启动恢复是否存在，列出 P0 缺口与本轮严格范围和验收标准；不得修改业务源码、`.workbuddy/`、`overview.md`，不得提交/推送/合并。

## 2. 当前事实基线

### 2.1 Git 状态

- `git status --short --branch`：当前分支与 `origin/feat/memory-workbench-foundation` 对齐；工作树存在多项源码修改及未跟踪的 Proposal/Approval/Audit、Jsonl、Runtime Composition 文件。`.workbuddy/`、`overview.md`、`handoff-prompt.md` 也为未跟踪项，均不得纳入本轮交付。
- `git log -3 --oneline --decorate`：
  - `5586f4a (HEAD -> feat/memory-workbench-foundation, origin/feat/memory-workbench-foundation) feat: add v0.2 hybrid search and safe writes`
  - `15d6787 fix: harden readonly index lifecycle updates`
  - `91aa19f feat: integrate readonly search lifecycle`
- `git diff --stat`：13 个已跟踪文件，207 insertions / 190 deletions；未跟踪持久化相关文件不计入该统计。

### 2.2 当前运行时组合（真实使用）

`src/services/runtimeComposition.ts` 当前实际组装：

- `ProposalStore`：`InMemoryProposalStore`。
- `ApprovalStore`：`InMemoryApprovalStore`。
- `AuditStore`：未接入。`WriteService` 使用内嵌 `MemoryAuditSink`（仅内存 `AuditEvent[]`），不是 `AuditStore`。
- `JsonlProposalStore`、`JsonlApprovalStore`、`JsonlAuditStore`、`JsonlAuditSink`、`WritePortJsonlStorage`：源码文件已存在（当前为未跟踪文件），但未被 runtime composition 使用。
- `ObsidianWritePort`：adapter 已存在，`WriteService` 和 `ProposalApplyService` 各自实例化；可读写 Markdown，但当前实现通过 `vault.modify`，文档注释已明确不保证平台级临时文件 + fsync + 原子 rename。
- 启动恢复：不存在。`main.ts` 启动时只 `composeRuntime()`，随后异步调用 `lifecycle.rebuild()`；没有加载 pending proposal、approval、pending-compensation 审计或一致性扫描/补偿。
- 运行时 feature flags：搜索和写入 flags 会传入基础服务；持久化 adapter 路径、Vault 受保护目录和独立本地目录没有配置或接入。

### 2.3 已存在但未闭环的服务/端口

- 端口：`ProposalStore`、`ApprovalStore`、`AuditStore` 均已定义，接口带 `RequestContext`。
- 服务：`ProposalService`、`ApprovalService`、`ProposalApplyService` 已存在并有单元/QA 覆盖。
- Jsonl adapter：支持按 JSONL 文档 load/flush，坏行跳过；proposal 支持状态更新，approval 保留首条决定，audit 支持查询和 retry 接口。
- 关键缺口：Jsonl adapter 没有 runtime wiring；没有 Vault + 独立本地目录双写；没有双写失败后的 `pending-compensation` 生成/恢复/补偿；没有启动时从持久化记录恢复队列；审计仍由 `MemoryAuditSink` 接收，重启丢失。

## 3. 基线验证

| 检查 | 结果 | 说明 |
|---|---|---|
| `npm test` | **PASS，41/41** | 通过 `npm --prefix E:/TT/workbuddy工作/2026-08-08-12-17-00 test` 执行，包含 `proposalAuditQa.test.ts` |
| `npm run build` | **FAIL** | `src/adapters/jsonlAuditStore.ts:14` 对 `AuditEvent`/`AuditRecord` 联合类型使用 spread，TS2698/TS2339 |
| `npm run lint` | **FAIL** | 1 error（同一 `jsonlAuditStore.ts:14` unsafe assignment）+ 14 warnings |
| `tsc --noEmit` | **FAIL** | 与 build 相同的 3 个 TypeScript 错误 |
| `git diff --check` | **PASS** | 仅有 Git 的 LF→CRLF 提示，无 whitespace error |
| CI workflows | **未发现** | `.github/workflows/*` 当前无匹配文件；不能据此宣称 CI 已覆盖该专项 |

## 4. 产品定义

### Product Goals

1. **可恢复**：插件重启后，待审批 proposal、approval 记录和待补偿审计必须可恢复，不依赖进程内内存。
2. **可追溯**：proposal、approval、apply 和 audit 使用同一 `request_id`/内容标识，可查询、可重试且不静默丢失。
3. **安全接入**：持久化 runtime 接入不得绕过现有 `Proposal/Approval -> WriteService -> WritePort -> Index -> Audit` 边界，默认写入开关仍关闭。

### User Stories

- As a user, I want pending proposals to remain after restarting Obsidian so that I can continue review safely.
- As a user, I want approvals and audits linked by request ID so that every write has traceable evidence.
- As an operator, I want persistence failures surfaced as pending compensation so that no record is falsely reported as complete.
- As a developer, I want runtime composition to inject durable stores so that tests can swap in-memory and JSONL implementations.

## 5. 需求池与本轮范围

### P0（本轮必须）

- Runtime composition 必须以依赖注入方式选择并连接持久化 `ProposalStore`、`ApprovalStore`、`AuditStore`；不得继续只使用内存实现。
- 持久化 adapter 必须至少支持启动 load/recovery，不能因文件不存在、空文件或坏 JSONL 行导致插件启动失败。
- 启动时必须恢复 pending proposal、approval 关联状态和 pending-compensation 审计列表，并暴露给后续服务/状态展示。
- 写入审计不能只落 `MemoryAuditSink`；成功、冲突、失败和待补偿状态必须进入持久化路径。
- 所有持久化 I/O 继续携带 `RequestContext`，且不得接入 Hermes CLI、`child_process`、shell 或终端执行。

### P1（后续紧接）

- Proposal/approval/audit 的 Vault 受保护目录 + 独立本地目录双写。
- 双写任一端失败时生成并持久保存 `pending-compensation`，启动时可恢复并支持 retry。
- 运行时仅创建一份共享 `ObsidianWritePort`/持久化配置，避免服务间 adapter 配置漂移。
- 增加重启恢复、坏行、重复记录、幂等、双写失败和补偿测试，并纳入默认测试/CI。

### P2（不属于本轮）

- 审计查询 UI、proposal diff UI、批量审批 UI。
- 回滚快照、平台级 fsync/临时文件原子替换增强。
- 移动端适配与 V0.4 研究/动态记忆发布。

### 严格不在本轮

- 不改写搜索、整理规则、Dashboard 布局或 Vault 事实源策略。
- 不扩大写入白名单，不默认开启 `new_write_pipeline`。
- 不修改 `.workbuddy/`、`overview.md`、`handoff-prompt.md`。
- 不提交、推送、合并，不操作 `main`。

## 6. UI/运行时设计草案

- `composeRuntime(app, settings)` 应集中创建持久化 storage、Proposal/Approval/Audit stores 与 facade，并将同一实例注入 proposal/approval/apply/write 链路。
- `onload` 在启动 rebuild 之外，必须执行一次非阻塞 recovery：加载可恢复记录，统计 pending proposal / pending compensation，并在失败时显示 degraded 状态而不阻塞插件基本启动。
- 持久化文件应位于受保护、可配置的路径；路径解析不得硬编码用户机器目录。
- 当前阶段只要求运行时可恢复与可观测，不要求新增审批 UI；现有 Dashboard 不得回归。

## 7. 验收标准

1. 新建 runtime 后，`ProposalService`、`ApprovalService`、`ProposalApplyService` 使用持久化 store；不再使用 `InMemoryProposalStore`/`InMemoryApprovalStore` 作为生产默认实现。
2. `WriteService` 产生的审计经 `AuditStore` 持久化；重启/重新创建 runtime 后可按 `request_id` 查询。
3. 模拟进程重启：待审批 proposal 与 approval 记录可恢复，状态不回退、不重复写入。
4. 模拟空文件、缺文件、包含坏 JSONL 行：启动不崩溃，有明确 degraded/恢复结果，合法记录仍可读取。
5. 模拟持久化写失败：不得报告成功；记录进入 `pending-compensation` 或明确失败状态，重启后仍可发现并 retry。
6. `npm test`、`npm run build`、`npm run lint`、`tsc --noEmit`、`git diff --check` 全部通过；QA 测试纳入默认测试入口或 CI。
7. Vault Markdown 仍为唯一事实源；关闭所有新写开关时不产生 Vault 内容写入。
