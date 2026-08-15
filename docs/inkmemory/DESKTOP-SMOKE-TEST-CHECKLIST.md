# 墨忆台 Memory Workbench — 桌面 Smoke Test 清单

> 本清单面向非编程用户，用于在真实 Obsidian 桌面环境中逐步验证插件功能。
> 每一步请按顺序执行，并在对应栏目填写结果：PASS / FAIL / BLOCKED。

## 准备工作

6. 确认已构建：`npm run build`（生成 `main.js` + `styles.css`）
7. 文件通过 junction 链接自动部署到 `C:/Users/TT/Documents/knowledge-vault/.obsidian/plugins/agent-dashboard/`
8. 打开 Obsidian，进入 设置 → 第三方插件，关闭"安全模式"
9. 在插件列表中找到"墨忆台 Memory Workbench"，点击启用

---

## 新增测试项（知识星图 + 每日热点）

| # | 操作 | 期望结果 | 实际结果 |
|---|------|---------|---------|
| 36 | 点击侧边栏「知识星图」导航按钮 | 切换到知识星图页面，显示 Canvas 力导向图 | |
| 37 | 在知识星图页面鼠标拖拽 | 图节点可拖拽移动 | |
| 38 | 侧边栏「每日热点」导航按钮 | 切换到每日热点页面，显示 6 条热点卡片 | |
| 39 | 侧边栏「总览」导航按钮 | 返回总览页，显示双栏网格（知识星图预览 + 最近更新 + 生产动态 + 健康度） | |
| 40 | 总览页点击「进入星图」按钮 | 跳转到知识星图页面 | |

---

## A. 插件启动

| # | 操作 | 期望结果 | 实际结果 |
|---|------|---------|---------|
| 1 | 将 main.js / manifest.json / styles.css 复制到插件目录 | 文件复制成功，无报错 | |
| 2 | 在设置中启用插件 | 插件启用，无红色错误提示 | |
| 3 | 观察 Obsidian 是否报错 | 控制台无报错（按 Ctrl+Shift+I 打开开发者工具查看 Console 标签） | |
| 4 | 点击左侧栏的仪表盘图标，或使用命令面板搜索"打开智能体工作台" | Dashboard 面板可正常打开，显示界面 | |
| 5 | 等待首次索引重建完成 | Dashboard 中索引状态从"重建中"变为"就绪" | |

## B. 只读搜索

| # | 操作 | 期望结果 | 实际结果 |
|---|------|---------|---------|
| 6 | 在 Dashboard 搜索框输入一个你笔记中存在的关键词 | 搜索结果列表显示匹配的笔记 | |
| 7 | 点击搜索结果中的某条笔记 | 能跳转到原文或显示原文路径 | |

## C. Proposal 创建

| # | 操作 | 期望结果 | 实际结果 |
|---|------|---------|---------|
| 8 | 在设置中开启至少一个整理开关（如 frontmatter），然后触发整理 | 系统生成整理计划，包含 Proposal | |
| 9 | 查看 Proposal 列表或详情 | 可以预览 Proposal 内容 | |
| 10 | 检查 Proposal 字段 | 包含 path、zone、kind、before、after、diff、base_hash、状态字段 | |
| 11 | 对 fiction 区域的笔记触发整理 | 生成的 Proposal 不会自动写入，状态为 proposal-only | |
| 12 | 对 unknown 区域的笔记触发整理 | 生成的 Proposal 不会自动写入，状态为 proposal-only | |

## D. 单条审批

| # | 操作 | 期望结果 | 实际结果 |
|---|------|---------|---------|
| 13 | 对某个 Proposal 选择 reject | Proposal 状态变为 rejected，普通 Markdown 内容未改变 | |
| 14 | 对另一个 Proposal 选择 approve，然后 apply | 写入成功，Proposal 状态变为 applied | |
| 15 | 检查 approve 后的索引状态 | 索引已刷新，搜索能找到更新后的内容 | |
| 16 | 查询审计记录 | 可以查到对应的审计事件，包含 request_id、path、result | |

## E. Hash Conflict

| # | 操作 | 期望结果 | 实际结果 |
|---|------|---------|---------|
| 17 | 创建一个 Proposal 后，手动在 Obsidian 中编辑目标文件并保存 | 目标文件内容已改变 | |
| 18 | 对该 Proposal 执行 approve + apply | 结果为 conflict，不执行写入 | |
| 19 | 检查目标文件内容 | 普通 Markdown 内容保持手动修改后的版本，未被覆盖 | |
| 20 | 检查 apply 结果 | 状态为 conflict，error_code 为 HASH_CONFLICT，未伪造成功 | |

## F. 重启恢复

| # | 操作 | 期望结果 | 实际结果 |
|---|------|---------|---------|
| 21 | 创建若干 Proposal 和 Approval 后，完全关闭 Obsidian | Obsidian 进程结束 | |
| 22 | 重新打开 Obsidian | 插件正常加载，无报错 | |
| 23 | 检查 Proposal 列表 | 之前的 Proposal 已恢复 | |
| 24 | 检查 Approval 记录 | 之前的 Approval 已恢复 | |
| 25 | 检查 Audit 记录 | 之前的 Audit 记录已恢复 | |
| 26 | 检查是否有自动 apply 发生 | 重启后没有自动 apply 任何 Proposal | |
| 27 | 对恢复后的已 approved Proposal 执行 apply | 仍可正常写入 | |

## G. 恢复失败降级

| # | 操作 | 期望结果 | 实际结果 |
|---|------|---------|---------|
| 28 | 关闭 Obsidian，用文本编辑器打开 `_workbench/proposals/records.jsonl`，在中间插入一行乱码（如 `{{{broken json{{{`），保存 | 文件已损坏 | |
| 29 | 重新打开 Obsidian | 插件仍能启动，不崩溃 | |
| 30 | 打开 Dashboard 和搜索 | Dashboard 和搜索功能仍可用 | |
| 31 | 尝试 approve 或 apply 一个 Proposal | 操作被阻断，返回 PERSISTENCE_DEGRADED 或类似降级提示 | |
| 32 | 检查 UI 或控制台 | 可以看到持久化降级状态信息 | |

## H. 安全边界

| # | 操作 | 期望结果 | 实际结果 |
|---|------|---------|---------|
| 33 | 确认 semantic_search 开关为关闭状态，然后启动插件 | 插件正常启动，搜索使用关键词模式 | |
| 34 | 检查项目依赖 | 没有新增 child_process / spawn / terminal 依赖（查看 main.js 中不含这些调用） | |
| 35 | 在搜索框输入 proposal 或 audit 相关关键词 | 搜索结果中不出现 `_workbench/` 目录下的 JSONL 记录 | |

---

## 结果汇总

| 分类 | 总项数 | PASS | FAIL | BLOCKED |
|------|--------|------|------|---------|
| A. 插件启动 | 4 | | | |
| B. 只读搜索 | 2 | | | |
| C. Proposal 创建 | 5 | | | |
| D. 单条审批 | 4 | | | |
| E. Hash Conflict | 4 | | | |
| F. 重启恢复 | 7 | | | |
| G. 恢复失败降级 | 5 | | | |
| H. 安全边界 | 3 | | | |
| I. 新功能（星图/热点/导航） | 5 | | | |
| **合计** | **40** | | | |

## 失败项记录

对每个 FAIL 或 BLOCKED 项，请记录：

- 编号：
- 发生了什么：
- 是插件崩溃 / 数据丢失 / 状态伪造 / 提示不足：
- 严重程度（P0 致命 / P1 严重 / P2 一般）：
- 复现步骤：
