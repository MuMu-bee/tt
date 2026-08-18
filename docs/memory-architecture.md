# 墨忆台 · 记忆系统架构（TencentDB 4 层）

本文档记录墨忆台（Memory Workbench）对 TencentDB Agent Memory 4 层记忆架构的落地方式与开关配置。

## 层级与存储

| 层 | 名称 | 存储路径 | 格式 |
|---|---|---|---|
| L0 | 对话记忆 | `_memory/conversations/YYYY-MM-DD.jsonl` | 按天 JSONL，append-only |
| L1 | 原子记忆 | `_memory/records/YYYY-MM-DD.jsonl` | 按天 JSONL + 内存关键词索引 |
| L2 | 场景记忆 | `_memory/scenes/<slug>.md` + `_memory/.metadata/scene_index.json` | 人类可读 Markdown + 机器索引 |
| L3 | 人格记忆 | `_memory/persona.md` | 正文 + 自动追加「场景导航」段 |

派生记忆根目录 `_memory/` 已被知识索引排除，删除后可重建；Vault 笔记仍是唯一事实源。

## 关键设计折衷

TencentDB 允许 L2/L3 的 LLM 直接带文件工具写 `scene_blocks/`；墨忆台**不让 LLM 直写 Vault**：

- L1 提炼：LLM 只输出 JSON 数组，工程解析后写 JSONL。
- L2 场景：LLM 只输出 operations JSON（create/update/merge），工程经 `SceneStore` 落盘。
- L3 人格：LLM 只输出正文，工程写 `persona.md` 并追加场景导航。

召回采用渐进披露：**L3 画像 → L2 场景导航 → L1 原子 → L0 原文**，L1 稀疏时才回落 L0。

## Feature Flags（默认全部关闭）

```json
{
  "memory": {
    "enabled": false,
    "captureL0": false,
    "autoExtract": false,
    "autoRecall": false,
    "recallDepth": "l3"
  }
}
```

- `enabled`：记忆系统总开关。
- `captureL0`：把每轮对话原样追加到 L0。
- `autoExtract`：从对话自动提炼 L1/L2/L3。
- `autoRecall`：发送消息前自动注入记忆上下文。
- `recallDepth`：每轮预注入的深度上限（l1/l2/l3）。

## 调度器

- **L1 warm-up**：阈值 1→2→4→…→N（默认 N=5），达到阈值立即提炼。
- **L1 idle flush**：每轮用户消息重置倒计时；超时（默认 600s）后把未达标缓冲强制提炼。
- **L2 downward-only timer**：L1 完成后把 L2 触发时间提前到 `max(now + delayAfterL1, lastL2 + minInterval)`，绝不推迟。
- **L3 全局 mutex**：并发=1，pending 去重，避免并发写 persona。

## 统一写入与审计

- 插件自产 Markdown 走 `WorkbenchWriteService`（研究/图片/项目报告、日记、Inbox）。
- 提案类写入走 `WriteService`（Proposal/Approval/Audit）。
- 回滚与记忆快照写入补审计事件。
- 密钥（API Key / GitHub Token）保存在插件目录 `secrets.json`（0600），不再写入 `data.json`。
