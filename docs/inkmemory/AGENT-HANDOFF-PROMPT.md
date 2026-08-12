# 墨忆台 Memory Workbench — Agent 交接提示词

> 使用方法：把本文件全部内容复制，粘贴给新的 AI 助手（如 Claude / Codex / 其他 agent），
> 作为它的第一条指令。它会据此快速理解项目并接手。

---

## 一、项目身份信息

- **项目名称**：墨忆台 Memory Workbench（Obsidian 插件，内部包名 `agent-dashboard`）
- **GitHub 仓库**：https://github.com/MuMu-bee/tt
- **本地项目目录**：`E:/TT/workbuddy工作/2026-08-08-12-17-00`
- **当前分支**：`feat/memory-workbench-foundation`
- **PR**：https://github.com/MuMu-bee/tt/pull/1 （状态 OPEN，目标分支 `main`，尚未合并）
- **基线提交**：`4f361e9`（feat: knowledge graph, daily hot, page redesign, and Obsidian CSS variable migration）
- **用户画像**：项目所有者是编程小白，所有交付要面向可操作结果，不要让他自己排查代码

## 二、这个项目是什么

一个 Obsidian 桌面插件，做"记忆工作台"：
- **只读知识索引与搜索**：扫描 Vault 内 Markdown 笔记，建立关键词索引，支持混合搜索（semantic 不可用时自动降级为纯关键词）
- **整理工作台（Proposal/Approval/Audit 闭环）**：
  - 对笔记生成整理方案（补全 frontmatter / 补充标签 / 补充反向链接 / 格式规范化）
  - 方案（Proposal）持久化到 Vault 内 `_workbench/proposals/records.jsonl`
  - 单条批准/拒绝（Approval）持久化到 `_workbench/approvals/records.jsonl`
  - 执行写入（apply）前**重新读取目标文件并校验 base_hash**，hash 不一致 → 零写入，标记 conflict
  - 所有写入经 `WriteService → WritePort → ObsidianWritePort`，UI 不直接碰 `vault.modify/create`
  - 审计记录（Audit）持久化到 `_workbench/audit/events.jsonl`
- **安全默认**：所有整理/写入开关默认关闭；fiction / unknown 区域的方案即使批准也绝不写入（proposal-only）
- **知识星图**：Canvas 力导向图展示笔记关联，支持图谱透镜筛选
- **每日热点**：聚合公开热点，卡片式排名展示
- **8 页面导航**：总览 / 知识库 / 知识星图 / 任务与计划 / 项目追踪 / 每日热点 / 对话 / 设置

## 三、当前真实状态（截至 2026-08-12）

### 已完成并验证
- 持久化 Proposal/Approval/Audit adapter 已接入生产 runtime（`runtimeComposition.ts` 使用 `JsonlProposalStore` / `JsonlApprovalStore` / `JsonlAuditStore` / `JsonlAuditSink`，不再使用内存 store）
- `main.ts` 在 `onload` 中 `await composeRuntime(...)`，启动时执行 restore（单一路径，无双重调用）
- 恢复失败进入 degraded：`PersistenceGate.isWritable()` 为 false 时，`WriteService` 返回 `PERSISTENCE_DEGRADED`，`ProposalApplyService.apply` 同样被阻断
- 坏 JSONL 行跳过并计数（skipped_rows），空文件/目录不存在安全处理
- 工作台新增「整理工作台」区块：持久化状态横幅、生成整理计划、Proposal 列表（批准/拒绝/执行写入）、审计记录折叠区；按钮逻辑抽成纯函数 `src/views/proposalViewState.ts`
- **知识星图**：Canvas 力导向图，节点按颜色分类（Wiki/Raw/灵感/内容），图谱透镜筛选，底部统计
- **每日热点**：6 条热点卡片，排名 + 分类标签 + 热度数据
- **页面切换**：8 页面导航（总览/知识库/知识星图/任务与计划/项目追踪/每日热点/对话/设置），`showPage()` 机制
- **CSS 重写**：使用 Obsidian 原生 CSS 变量替代自定义 `--agent-*` 变量，自动跟随主题
- **全量测试 92/92 PASS**（`npm test`），build / tsc / lint（0 errors）/ git diff --check 全部通过
- 已部署到本地 Obsidian vault（junction 链接：`C:/Users/TT/Documents/knowledge-vault/.obsidian/plugins/agent-dashboard/` → `deploy/`）
- 已推送到 GitHub：`4f361e9` 在 `feat/memory-workbench-foundation` 分支

### 尚未完成 / 已知缺口
1. **真实桌面 smoke test 未跑**：35 项人工验证清单见 `docs/inkmemory/DESKTOP-SMOKE-TEST-CHECKLIST.md`，需在真实 Obsidian 中逐项验证
2. **PR #1 未合并**：必须等用户明确指示
3. **知识星图数据为模拟数据**：当前使用随机生成节点和边，未接入真实 Vault 笔记的 `[[wikilinks]]` 数据（索引中尚无 link 提取）
4. **每日热点数据为模拟数据**：当前使用硬编码热点，未接入真实公开 API
5. **lint 有 18 个既有 warning**（既有代码，非本轮引入）
6. **单端持久化**（仅 Vault 内 JSONL），非双端；`pending-compensation` 仅为状态标识，非真实补偿队列
7. **V0.4 未开始**：后台研究、Hermes 记忆发布尚未实现
8. **V0.5 未开始**：定时巡检、主动编排尚未实现

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
  → JsonlAuditSink → JsonlAuditStore（审计）
  → 启动时 await restore；失败 → degraded → 阻断 apply/write
```

## 五、硬性约束（违反即事故）

1. 只改 `feat/memory-workbench-foundation` 分支；**不得**合并 PR #1、不得 push/修改 `main`
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
2. **跑基线**：`npm test`、`npm run build`、`npm run lint`、`tsc --noEmit -skipLibCheck`、`git diff --check`，确认 53/53 与全绿
3. **核验 runtime**：确认 `runtimeComposition.ts` 使用 JSONL 持久化 adapter、`main.ts` 单条 restore 路径、feature flags 默认关闭
4. **检查部署**：确认 `C:/Users/TT/Documents/knowledge-vault/.obsidian/plugins/agent-dashboard/` 下的 main.js 是否与最新源码一致（不一致需重新 build 并复制）
5. **向用户确认**：让用户在真实 Obsidian 中打开工作台验证「整理工作台」区块；按 35 项清单逐步验证
6. **汇报**：用简体中文，区分"已真实验证"与"仅测试通过"，不夸大

## 七、常见命令速查

```bash
cd "E:/TT/workbuddy工作/2026-08-08-12-17-00"
npm test                      # 53/53
npm run build                 # 生成 main.js（构建产物，gitignore）
npm run lint                  # 0 errors / 10 warnings（既有）
node node_modules/typescript/bin/tsc -noEmit -skipLibCheck
git diff --check
# 部署到 Obsidian（构建后）：
# 复制 main.js / manifest.json / styles.css 到
# C:/Users/TT/Documents/knowledge-vault/.obsidian/plugins/agent-dashboard/
```

---

## 交接说明（给项目所有者）

- 本文件位于 `docs/inkmemory/AGENT-HANDOFF-PROMPT.md`，复制全文给新 agent 即可
- 新 agent 接手后应能独立完成：跑基线 → 读代码 → 核对 runtime → 指导你完成桌面验证 → 按你的指示决定是否合并 PR
- 如新 agent 声称"已完成"但没给出上述验证结果，要求它先跑基线再说话
