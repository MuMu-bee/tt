# Agent Dashboard（智能体工作台 / 墨忆台）

一个运行在 Obsidian 内的智能体工作台插件。它提供个人工作概览、信息流聚合、Vault 健康检查、AI 对话（墨忆台）等能力，是「墨忆台（Memory Workbench）」产品的基础外壳与 Dashboard 实现。

> 产品设计与路线图见 [`docs/inkmemory/`](docs/inkmemory/)：PDR、ROADMAP、技术设计与迁移计划。

## 功能特性

- **总览 Dashboard**：Vault 健康分、Inbox 待处理、任务流、笔记创建活跃度热力图（近 12 个月）。
- **快捷操作**：新建日记、深度研究、拉取 RSS 摘要、GitHub 动态精选、收件箱导入、Vault 检查（lint）。
- **信息流聚合**：GitHub AI Agent 仓库、RSS、HackerNews，带 1 小时本地缓存。
- **Vault 扫描**：frontmatter / 标签覆盖率、孤立笔记、30 天未修改提醒、今日任务。
- **墨忆台对话（开发中）**：基于 Vault 上下文注入的本地 / 云端 LLM 对话，支持流式输出。

## 安装

1. 下载最新的 [Release](https://github.com/MuMu-bee/tt/releases) 中的 `main.js`、`manifest.json`、`styles.css`。
2. 放入 Vault 的 `.obsidian/plugins/agent-dashboard/` 目录。
3. 在 Obsidian「设置 → 第三方插件」中启用「Agent Dashboard」。

## 开发

要求 Node.js ≥ 22.6（测试脚本依赖 `--experimental-strip-types`）。

```bash
npm install
npm run dev        # 监听模式编译
npm run build      # 类型检查 + 生产构建
npm test           # 运行测试
npm run lint       # ESLint
```

## 设置

- **智能体命令**：Hermes 命令路径（桌面端深度研究 / 摘要使用）。
- **墨忆台 · 模型设置**：本地 Ollama 或云端 OpenAI 兼容 API（模型、地址、密钥）。
  - 注意：云端 API 密钥以明文保存在插件数据文件（`.obsidian/plugins/agent-dashboard/data.json`）中，请勿在共享设备上使用。

## 项目结构

```
src/
├── main.ts                      # 插件入口
├── settings.ts                  # 设置页
├── data/dashboardTypes.ts       # 类型与常量
├── services/                    # 业务服务（扫描、信息流、对话、缓存、Vault 上下文）
├── ui/                          # 弹窗组件
└── views/AgentDashboardView.ts  # Dashboard 视图
docs/inkmemory/                  # 墨忆台产品与设计文档
tests/                           # 单元测试（node:test）
```
