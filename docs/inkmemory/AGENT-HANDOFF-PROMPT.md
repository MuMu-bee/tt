# 墨忆台 Memory Workbench — Agent 交接提示词

> 使用方法：把本文件全部内容复制，粘贴给新的 AI 助手（如 Claude / Codex / 其他 agent），
> 作为它的第一条指令。它会据此快速理解项目并接手。

---

## 一、项目身份信息

- **项目名称**：墨忆台 Memory Workbench（Obsidian 插件，内部包名 `agent-dashboard`）
- **GitHub 仓库**：https://github.com/MuMu-bee/tt
- **本地项目目录**：以当前 checkout 为准；本文不绑定历史机器路径
- **当前分支**：`main`
- **PR**：https://github.com/MuMu-bee/tt/pull/1 （**已合并** 2026-08-15）
- **PR #2**：https://github.com/MuMu-bee/tt/pull/2 （**已合并** 2026-08-17）
- **当前 HEAD**：`edbb9b2`（merge PR #2；完整 SHA 以 Git 为准）
- **最新 Release**：`0.1.0`，tag `3f7ffc2`，早于当前 `main`
- **历史基线提交**：`4f361e9`（feat: knowledge graph, daily hot, page redesign, and Obsidian CSS variable migration）——不代表当前 HEAD
- **用户画像**：项目所有者是编程小白，所有交付要面向可操作结果，不要让他自己排查代码

## 二、这个项目是什么

一个 Obsidian 桌面插件，做"记忆工作台"：
- **只读知识索引与搜索**：扫描 Vault 内 Markdown 笔记，建立关键词索引，支持混合搜索（semantic 不可用时自动降级为纯关键词）
  - **整理工作台（Proposal/Approval/Audit 基础闭环）**：
  - 对笔记生成整理方案（补全 frontmatter / 补充标签 / 补充反向链接 / 格式规范化）
  - 方案（Proposal）持久化到 Vault 内 `_workbench/proposals/records.jsonl`
  - 单条批准/拒绝（Approval）持久化到 `_workbench/approvals/records.jsonl`
  - 执行写入（apply）前**重新读取目标文件并校验 base_hash**，hash 不一致 → 零写入，标记 conflict
  - Proposal apply 核心写入经 `WriteService → WritePort → ObsidianWritePort`；其他报告、AgentAction 和回滚路径的直写缺口见当前已知问题
  - 审计记录（Audit）持久化到 Vault 的 `_workbench/audit/events.jsonl`，并写入插件数据目录的 `audit/events.jsonl` 镜像；镜像失败进入待补偿状态
- **安全默认**：所有整理/写入开关默认关闭；fiction / unknown 区域的方案即使批准也绝不写入（proposal-only）
- **知识星图**：Canvas 力导向图展示笔记关联，支持图谱透镜筛选
- **每日热点**：聚合公开热点，卡片式排名展示
- **8 页面导航**：总览 / 知识库 / 知识星图 / 任务与计划 / 项目追踪 / 每日热点 / 对话 / 设置

## 三、当前真实状态（截至 2026-08-17，HEAD `edbb9b2`）

### 已完成并验证
- 持久化 Proposal/Approval/Audit adapter 已接入生产 runtime（`runtimeComposition.ts` 使用 `JsonlProposalStore` / `JsonlApprovalStore` / `JsonlAuditStore` / `JsonlAuditSink`，不再使用内存 store）；正常恢复路径可用，但异常恢复重试和并发 flush 仍有缺口
- `main.ts` 在 `onload` 中 `await composeRuntime(...)`，启动时执行 restore（单一路径，无双重调用）
- 恢复失败进入 degraded：`PersistenceGate.isWritable()` 为 false 时，`WriteService` 返回 `PERSISTENCE_DEGRADED`，`ProposalApplyService.apply` 同样被阻断
- 坏 JSONL 行跳过并计数（skipped_rows），空文件/目录不存在安全处理
- 工作台新增「整理工作台」区块：持久化状态横幅、生成整理计划、Proposal 列表（批准/拒绝/执行写入）、审计记录折叠区；按钮逻辑抽成纯函数 `src/views/proposalViewState.ts`
- **知识星图**：Canvas 力导向图，节点按颜色分类（Wiki/Raw/灵感/内容），图谱透镜筛选，底部统计
- **每日热点**：6 条热点卡片，排名 + 分类标签 + 热度数据
- **页面切换**：8 页面导航（总览/知识库/知识星图/任务与计划/项目追踪/每日热点/对话/设置），`showPage()` 机制
- **CSS 重写**：使用 Obsidian 原生 CSS 变量替代自定义 `--agent-*` 变量，自动跟随主题
- **测试 101/101**（`npm test`）；`npm run build`、`tsc --noEmit -skipLibCheck`、`git diff --check` 通过；`npm run lint` 为 0 error、22 warnings
- 当前没有本次审查范围内的真实 Obsidian 桌面 smoke test 证据；不能把 Node 测试结果当作桌面验证
- 当前 `main` 已推送到 GitHub，HEAD 为 `edbb9b2`；`0.1.0` Release 仍来自旧 tag `3f7ffc2`

### 尚未完成 / 已知缺口（截至 2026-08-17，基于 HEAD `edbb9b2`）
1. **真实桌面 smoke test 未跑**：40 项人工验证清单见 `docs/inkmemory/DESKTOP-SMOKE-TEST-CHECKLIST.md`，需在真实 Obsidian 中逐项验证
2. **知识星图连接数据取决于笔记内容**：星图使用真实 `[[wikilinks]]` 数据，若笔记间无链接则星图只有孤立节点
3. **每日热点已接真实 API**（vvhan 聚合 + 知乎热榜，双源轮换），失败时显示失败提示而非模拟数据
4. **lint 有既有 warning**（既有代码；数量以实际运行 `npm run lint` 为准）
5. **持久化**：Proposal/Approval 为 Vault 单端 JSONL；Audit 为双端（Vault + 插件数据目录镜像）；审计落盘/镜像失败会标记 `pending-compensation`，可在工作台审计区重试
6. **后台研究为基础版**：支持搜索网络生成报告、任务取消与重试；排队/暂停未实现
7. **定时巡检为基础版**：每 30 分钟检查一次，含断链检测与过期 proposal 标记；主动建议未实现
8. **Hermes 记忆发布**（MemoryPublishService）服务存在但未接入 UI/命令
9. **回滚功能**已接入：已应用（applied）的 proposal 可在工作台一键回滚，另有"回滚当前文件"命令
10. **写入边界仍有缺口**：Proposal apply 核心路径经过 WriteService，但日报、研究/图片报告、AgentAction 和回滚仍存在 Vault 直写路径
11. **scope/Proposal 仍需加固**：WriteService 未完整验证 `scope_snapshot`，Proposal 未保存原始 scope snapshot，apply 时会重建为 file scope
12. **Audit/JSONL 并发与恢复仍需加固**：同文件 read-modify-write、restore 失败重试、Audit retry 失败后的 pending 保留、双端镜像恢复尚未形成完整闭环
13. **semantic scope 与增量更新仍有缺口**：内容修改 hash、tag scope、includes 和 prefix 边界需要补充实现与测试
14. **CI 门禁未建立**：当前 workflow 仅处理 tag 发布，PR/main 没有自动测试门禁，`main` 也未启用 branch protection

## 四、技术栈与架构

- **语言/构建**：TypeScript + esbuild（`esbuild.config.mjs`），Obsidian API（`obsidian` 包）
- **测试**：Node 内置 test runner，`node --test --experimental-strip-types`（**不要用 TypeScript parameter properties**，Node strip-only 模式不支持，构造器用显式字段赋值）
- **测试命令**：`npm test` / `npm run build` / `npm run lint` / `node node_modules/typescript/bin/tsc -noEmit -skipLibCheck` / `git diff --check`
- **分层**：`ports`（抽象接口）→ `adapters`（Obsidian/JSONL/内存实现）→ `services`（业务编排）→ `views`（UI）→ `application`（契约/类型/feature flags）

### 关键文件地图（接手必读）
| 文件 | 作用 |
|------|------|
| `src/main.ts` | 插件入口：await composeRuntime → restore → 注册视图/命令 |
| `src/services/runtimeComposition.ts` | **composition root**：组装全部服务，含 RuntimeAuditQuery.listRecent |
| `src/services/persistenceGate.ts` | 降级闸门：restore 汇总、isWritable() |
| `src/services/writeService.ts` | 受控写入：feature flag 检查、hash 校验、审计 |
| `src/services/proposalApplyService.ts` | apply 闭环：gate → 状态机 → hash 重校验 → 写入 → 审计 |
| `src/adapters/obsidianJsonlStorage.ts` | JSONL 元数据文件的 Vault 读写（非用户笔记） |
| `src/adapters/jsonlProposalStore.ts` 等 | 三个持久化 store（restore/load/flush，坏行跳过） |
| `src/views/AgentDashboardView.ts` | Dashboard UI，含 renderWorkbench 区块 |
| `src/views/proposalViewState.ts` | 纯函数：按钮可用性/状态文案（degraded 优先判定） |
| `src/application/contracts.ts` | Proposal/Approval/Audit/WriteResult 类型与错误码 |
| `src/application/featureFlags.ts` | 全部功能开关，默认关闭 |
| `tests/runtimePersistenceIntegration.test.ts` | 重启恢复/degraded/不自动 apply 集成测试 |
| `tests/proposalViewState.test.ts` | UI 按钮逻辑纯函数测试 |

### 核心数据流
```
Vault Markdown
  → ObsidianVaultReader（只读）
  → InMemoryVaultIndex / IndexLifecycleService
  → SearchService（关键词优先，semantic 降级）
  → OrganizeService（生成真实 before/after/diff 方案）
  → ProposalService → JsonlProposalStore（_workbench/proposals/records.jsonl）
  → ApprovalService → JsonlApprovalStore
  → ProposalApplyService：apply 前重读文件校验 base_hash
      ├─ 一致 → WriteService → WritePort → ObsidianWritePort → vault.modify
      ├─ 不一致 → conflict，零写入
      └─ fiction/unknown → proposal-only，零写入
  → IndexLifecycleService.modify（刷新索引）
  → JsonlAuditSink → JsonlAuditStore（Vault 审计主记录）
      └─ DualJsonlStorage（插件数据目录镜像；失败标记 pending-compensation）
  → 启动时 await restore；失败 → degraded → 阻断 apply/write
```

## 五、硬性约束（违反即事故）

1. 当前开发分支为 `main`；新改动请走新分支 + PR，**不要直接 push `main`**（除非用户明确要求）
2. **不得自动 commit / push**，除非用户明确要求
3. 禁止提交：`.workbuddy/`、`overview.md`、`handoff-prompt.md`、临时文件（如 `qa_check_mainjs.py`、`test-output.txt`）
4. `main.js` 被 `.gitignore` 排除（构建产物不入库，符合 Obsidian 规范；发布走 GitHub Releases）
5. 保留所有既有未提交修改，不得 `reset` / `checkout --` / 覆盖他人文件
6. 不新增 `child_process` / `spawn` / `exec` / shell / terminal；不接 Hermes CLI
7. 所有 UI 和业务服务不得直接调用 `vault.modify/create/delete/rename`（内部 JSONL 元数据文件除外）
8. 桌面验证通过前，不得把 `new_write_pipeline` 等默认开关改为开启
9. 代码兼容 Node `--experimental-strip-types`（无 parameter properties）
10. 不得把"测试通过/接口存在"说成"真实 Obsidian 已验证"；没有真实桌面环境时写 `桌面 smoke test：NOT RUN`

## 六、接手后的标准动作

1. **读代码**：先读第三节列出的关键文件，再读 `docs/inkmemory/PDR.md`、`TECHNICAL-DESIGN.md`、`PERSISTENCE-RUNTIME-INTEGRATION-ARCHITECTURE.md`、`DESKTOP-SMOKE-TEST-CHECKLIST.md`
2. **跑基线**：`npm test`、`npm run build`、`npm run lint`、`tsc --noEmit -skipLibCheck`、`git diff --check`，以实际输出为准；当前基线为 101/101、lint 0 error/22 warnings
3. **核验 runtime**：确认 `runtimeComposition.ts` 使用 JSONL 持久化 adapter、`main.ts` 单条 restore 路径、feature flags 默认关闭
4. **检查部署**：在用户指定的真实 Obsidian Vault 中确认插件构建产物是否与最新源码一致；本文件不把历史机器路径当作当前部署证据
5. **向用户确认**：让用户在真实 Obsidian 中打开工作台验证「整理工作台」区块；按当前 `DESKTOP-SMOKE-TEST-CHECKLIST.md` 逐步验证
6. **汇报**：用简体中文，区分"已真实验证"与"仅测试通过"，不夸大

## 七、常见命令速查

```bash
# 在当前 checkout 的仓库根目录执行
npm test                      # 当前基线 101/101，以实际输出为准
npm run build                 # 生成 deploy/main.js（构建产物，gitignore）
npm run lint                  # 当前基线 0 errors / 22 warnings，以实际输出为准
node node_modules/typescript/bin/tsc -noEmit -skipLibCheck
git diff --check
# 部署到 Obsidian（构建后）：
# 复制 deploy/main.js / manifest.json / styles.css 到用户指定的
# Vault/.obsidian/plugins/agent-dashboard/
```

---

## 交接说明（给项目所有者）

- 本文件位于 `docs/inkmemory/AGENT-HANDOFF-PROMPT.md`，复制全文给新 agent 即可
- 新 agent 接手后应能独立完成：跑基线 → 读代码 → 核对 runtime → 指导你完成桌面验证 → 按你的指示决定是否合并 PR
- 如新 agent 声称"已完成"但没给出上述验证结果，要求它先跑基线再说话
