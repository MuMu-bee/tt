# PDR: 墨忆台与 oyorf/person_dashboard 功能对比与可行性评估

> 生成时间：2026-08-12
> 项目：agent-dashboard（墨忆台 Memory Workbench）
> 参考：oyorf/person_dashboard (v0.1.0, MIT)
> 原则：本篇基于源代码逐项分析，禁止虚构数据或功能
> **文档性质：历史对比分析快照。** 文中的测试数量、功能清单和阶段判断以 2026-08-12 为准，不代表当前 `main`。当前仓库状态见 [`docs/inkmemory/AGENT-HANDOFF-PROMPT.md`](inkmemory/AGENT-HANDOFF-PROMPT.md)。

---

## 一、现有数据边界（关键约束）

### 1.1 VaultDocument 结构（`src/domain/vault-document.ts`）

```typescript
interface VaultDocument {
  path: string;        // 文件路径
  title: string;       // 笔记标题
  frontmatter: Record<string, unknown>;  // YAML 元数据
  tags: string[];      // 标签（frontmatter + inline）
  body: string;        // Markdown 正文
  raw: string;         // 原始文本
  raw_hash: string;    // SHA-256 哈希
}
```

**关键缺失：** `VaultDocument` **不包含 `links` 字段**。没有提取 `[[wikilinks]]` 双向链接，没有入链/出链数据。

### 1.2 索引数据（`src/domain/keyword-search.ts`）

```typescript
interface KeywordIndexEntry {
  document: VaultDocument;
  fields: {
    title: string;       // 笔记标题
    path: string;        // 文件路径
    frontmatter: string; // frontmatter 序列化
    tags: string;        // 标签（空格分隔）
    content: string;     // 正文全文
  };
}
```

索引是纯关键词搜索，**无图结构**。

### 1.3 截至 2026-08-12 的功能快照（当时 92 个测试通过）

| 功能 | 实现位置 |
|---|---|
| 关键词搜索 | `SearchService` + `InMemoryVaultIndex` |
| 语义搜索（Ollama bge-m3） | `ollamaSemanticSearch` |
| 云端模型（StepFun Pro） | `openAiModel` |
| 视觉模型（step-1o-turbo-vision） | `visionService` |
| 项目追踪（GitHub DeepTutor） | `projectTracker` |
| 整理工作台（Proposal/Approval/Audit） | `proposalService` + `approvalService` |
| 快捷操作（新建日记/深度研究/图片理解等） | `agentActionService` |
| 页面切换 | `AgentDashboardView.showPage()` |

---

## 二、oyorf 功能逐项评估（实事求是）

### 2.1 知识星图（Knowledge Graph）

**oyorf 实现：** `d3-force` + `gsap` 力导向图，节点 = 笔记，边 = 双向链接，支持搜索/筛选/节点检查器

**我们能做吗？** ✅ **有条件地能做**

| 前提条件 | 现状 | 需要做的工作 |
|---|---|---|
| 笔记间链接数据 | ❌ 不存在 | 需要在 `parseVaultDocument` 中提取 `[[wikilinks]]` |
| 力导向布局算法 | ❌ 无依赖 | 可以自己实现（纯数学，~100 行）或引入 d3-force |
| Canvas 渲染 | ✅ 浏览器原生支持 | 直接徒手写 Canvas |
| 节点交互（拖拽/缩放/点击） | ✅ 原生可选 | 需要实现 |

**工作量估算：** 新增 ~300 行代码（link 提取 + 力布局 + Canvas 渲染 + 交互）

### 2.2 每日热点（Daily Hot）

**oyorf 实现：** 调用公开匿名 API 聚合热点

**我们能做吗？** ✅ **可以做**

| 前提条件 | 现状 |
|---|---|
| 网络请求能力 | ✅ Obsidian `requestUrl` 可用 |
| API 来源 | 需找公开热点 API |
| 测试 | 需要写 mock 测试 |

**注意：** 热点聚合依赖外部 API 的可用性和稳定性，不属于代码可控范围。

### 2.3 社媒洞察（Social Insights）

**oyorf 实现：** 59KB 的大页面，AI 驱动的社媒研究 + 报告生成

**我们能做吗？** ⚠️ **部分可做**

我们已经有的：
- ✅ `projectTracker` 拉取 GitHub 项目动态
- ✅ `projectReportService` 生成中文报告
- ✅ 云端模型调用能力

我们没有的：
- ❌ 社媒数据源（Twitter/X、微博等 API）
- ❌ 浏览器自动化能力（无 puppeteer/playwright）

**评估：** 可以扩展 `projectTracker` 支持更多 GitHub 仓库，但多平台社媒追踪不可行。

### 2.4 抖音数据（Douyin Analytics）

**oyorf 实现：** 浏览器自动化访问抖音创作者中心，下载官方 Excel + 补充页面数据

**我们能做吗？** ❌ **不可行**

原因：
- Obsidian 插件环境不支持 `puppeteer`/`playwright`
- 项目安全边界禁止 `child_process`
- 需要用户登录态 + 浏览器自动化，超出插件能力范围

### 2.5 素材库 / 书架（Materials / Books）

**oyorf 实现：** 按 Raw/Wiki/灵感/内容分类展示笔记

**我们能做吗？** ✅ **可以做**

利用现有索引的 `tags` 字段，按标签筛选展示。不需要新增数据源。

### 2.6 搜索面板（Search Palette）

**oyorf 实现：** Cmd+K 全局搜索面板

**我们能做吗？** ✅ **已部分实现**

我们已有 `SearchService` + 知识库搜索 UI，可以优化为全局搜索面板。

### 2.7 页面设计（App Shell / 页面布局）

**oyorf 实现：** react-router 多页面路由，侧栏导航，浮动搜索按钮

**我们能做吗？** ✅ **已部分实现**

我们已有 `showPage()` 页面切换机制 + Apple 风格 UI，可以继续完善。

---

## 三、可行性总结

| 功能 | 可行性 | 工作量 | 依赖 |
|---|---|---|---|
| 页面设计优化 | ✅ 已有基础 | 小 | 无 |
| 知识星图 | ✅ 有条件 | 中 | 需先加 link 提取 |
| 搜索面板 | ✅ 已有基础 | 小 | 无 |
| 每日热点 | ✅ 可做 | 中 | 需找公开 API |
| 素材库/书架 | ✅ 可做 | 小 | 无 |
| 社媒洞察扩展 | ⚠️ 部分 | 中 | 限 GitHub |
| 抖音数据 | ❌ 不可行 | - | 插件限制 |

---

## 四、推荐实施计划

### Phase 1（当前可做，不改数据层）
1. 优化现有页面设计（卡片布局、排版）
2. 修复导航 + 页面切换（已完成）
3. 优化搜索面板 UI

### Phase 2（需新增 link 提取）
4. 在 `parseVaultDocument` 中添加 `[[wikilinks]]` 提取
5. 实现知识星图（Canvas + 力导向布局）
6. 添加 link 相关测试

### Phase 3（可选）
7. 每日热点页面
8. 素材库/书架（标签筛选展示）
9. 扩展项目追踪（多仓库支持）

---

## 五、不可行功能清单（坚决不做）

| 功能 | 不可行原因 |
|---|---|
| 抖音数据面板 | 插件环境无浏览器自动化能力 |
| 跨平台社媒追踪 | 需要 Twitter/微博等 API 密钥和 OAuth |
| 实时协作 | 插件是单用户本地工具 |
| 移动端 | `isDesktopOnly: true` |
