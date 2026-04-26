# 设计文档：移除精准模式 + TextRank 关键词提取

**日期：** 2026-04-26  
**状态：** 已批准

---

## 背景

当前插件有两种分类模式：
- **精准模式**（`useExactMode: true`）：使用 Mozilla Readability + LangChain map_reduce 生成完整摘要
- **普通模式**（`useExactMode: false`）：提取页面首段和中间段文本片段

两种模式共存增加了代码复杂度，且精准模式依赖重量级的 LangChain summarization chain。本次改造统一为单一流程，引入 segmentit 中文分词 + TextRank 关键词提取替代摘要策略。

关键词提取在**用户点击分组按钮时**触发，不做预加载，避免不必要的计算和 API 消耗。

---

## 目标

1. 删除精准分类模式的所有功能
2. 使用 `segmentit`（中文分词）+ TextRank 算法从页面纯文本中提取 3-5 个关键词，支持自定义词库
3. 调用 LLM 分组时传递网页标题和关键词

---

## 架构设计

### 统一数据流

```
用户点击分组按钮
  ↓
[background.ts] chrome.scripting.executeScript() 获取各 tab 的 HTML
  ↓
linkedom.parseHTML() 解析为 Document
  ↓
[aiServive.ts] stripHtml(doc) → 纯文本
  ↓
[aiServive.ts] extractKeywords(text) → string[] (3-5 个关键词)
  分词：segmentit（支持自定义词库）
  打分：TextRank（基于词共现图 + PageRank）
  ↓
[aiServive.ts] sendToAi({tabs: [{title, keywords}]}) → LLM 分组
  ↓
LLM 返回 JSON → Chrome tab groups
```

### 数据模型变更

**`PageSummaryResult`（简化）：**
```typescript
interface PageSummaryResult {
  keywords: string[];
}
```
移除原有的 `summary`、`headText`、`bodyText` 字段。

**`TabInfo`（简化）：**
```typescript
interface TabInfo {
  id: number;
  title: string;
  url: string;
  groupId: number;
  keywords: string[];  // 替换原来的 summary/headText/bodyText
}
```

**`AiProvider` / `AiConfig`：**
- 删除 `useExactMode` 字段

---

## 组件改动

### 1. `aiServive.ts`

**删除：**
- `useExactMode` 相关所有逻辑分支
- `loadSummarizationChain`、`RecursiveCharacterTextSplitter` 的使用
- `Readability` 相关导入和调用
- `PageSummaryResult` 中的 `summary`、`headText`、`bodyText` 字段
- `TabInfo` 中的 `summary`、`headText`、`bodyText` 字段

**新增：**
- `extractKeywords(text: string): string[]` 函数
  - 使用 `segmentit` 进行中文分词，支持通过 `segment.use()` 注入自定义词典模块
  - 基于分词结果构建词共现图，用 TextRank（PageRank 变体）打分
  - 过滤停用词（的、了、是、在等高频无意义词）
  - 返回得分最高的 3-5 个关键词
  - 若可提取词不足 3 个，返回实际数量

**修改 LLM Prompt：**

System message：
```
你是一个专业的网页标签分类助手。你需要根据网页标题和关键词对标签页进行智能分组。
```

Tab 数据格式（原来）：
```
[0]: 标题:xxx; 摘要: 【首段摘要如下】=>... 【页面中间摘要如下】=>...
```

Tab 数据格式（新）：
```
[0]: 标题:xxx; 关键词: [关键词1, 关键词2, 关键词3]
```

### 2. `configStorage.ts`

**删除：**
- `AiProvider.useExactMode` 字段定义
- 所有读写 `useExactMode` 的逻辑

### 3. UI 组件（`AppOptions.vue` / `AppProviderTypes.vue`）

**删除：**
- 精准模式开关 UI（toggle/checkbox）
- 相关的 `useExactMode` 数据绑定和事件处理

### 4. `background.ts`

- 移除预加载 summarize 队列中与精准模式相关的逻辑
- 关键词提取改为在分组触发时同步执行（不再预缓存）

---

## 依赖变更

**新增：**
- `segmentit`（纯 JS 中文分词，支持自定义词库，兼容 Chrome service worker）

**可移除（确认无其他使用后）：**
- `@mozilla/readability`
- `@langchain/textsplitters`

---

## 关键词提取规格

- 输入：页面 body 纯文本（已剥离所有 HTML 标签，空白已规范化）
- 分词：`segmentit`，可通过词典模块扩展专有名词
- 算法：TextRank（词共现窗口大小：2，迭代次数：10，阻尼系数：0.85）
- 输出：3-5 个关键词字符串数组，按 TextRank 得分降序排列
- 若文本过短（关键词不足 3 个），返回实际可提取数量

---

## 错误处理

- 关键词提取失败：返回空数组 `[]`，LLM 仍可根据标题分组
- HTML 剥离后文本为空：关键词为空数组，仅凭标题分组
- segmentit 初始化失败：降级为按空格/标点简单切词
