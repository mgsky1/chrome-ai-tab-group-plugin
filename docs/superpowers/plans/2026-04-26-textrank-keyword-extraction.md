# TextRank 关键词提取 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除精准分类模式，引入 segmentit + TextRank 关键词提取，在调用 LLM 分组时传递网页标题和关键词，并支持用户在 Options 页面配置自定义词库。

**Architecture:** 用户点击分组按钮时，background.ts 获取所有未分组标签页的 HTML，传给 aiServive.ts 做 HTML 剥离 + segmentit 中文分词 + TextRank 打分提取 3-5 个关键词，再将 `{title, keywords[]}` 传给 LLM 进行分组。自定义词库存储在 `chrome.storage.sync`，分词时注入 segmentit 确保专有名词不被拆分。

**Tech Stack:** TypeScript, Vue 3, segmentit (中文分词), Chrome Extension APIs (chrome.storage.sync/local), LangChain ChatOpenAI

---

## 文件变更映射

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/background/aiServive.ts` | 修改 | 删除精准模式，新增 `extractKeywords()`，简化类型，修改 prompt |
| `src/background/configStorage.ts` | 修改 | 删除 `useExactMode`，新增 `loadCustomDict`/`saveCustomDict` |
| `src/background/background.ts` | 修改 | 删除 `useExactMode` 引用，修改 `groupTabs()` 读取自定义词库并传给 aiService |
| `src/pages/options/AppOptions.vue` | 修改 | 删除精准模式 UI，新增自定义词库入口链接 |
| `src/pages/options/AppCustomDict.vue` | 新建 | 自定义词库管理页面 |
| `src/pages/options/router.ts` | 修改 | 注册 `/custom-dict` 路由 |
| `package.json` | 修改 | 新增 `segmentit` 依赖 |

---

## Task 1: 安装 segmentit 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 segmentit**

```bash
cd /Users/huangzhiyuan/Desktop/front-site/chrome-ai-tab-group-plugin
npm install segmentit
```

Expected output: segmentit 出现在 `node_modules/` 且 `package.json` dependencies 中包含 `"segmentit": "^x.x.x"`

- [ ] **Step 2: 验证安装**

```bash
ls node_modules/segmentit
```

Expected: 目录存在，包含 `index.js` 等文件

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add segmentit dependency"
```

---

## Task 2: 简化 aiServive.ts 类型定义，删除精准模式相关类型

**Files:**
- Modify: `src/background/aiServive.ts`

此任务只改类型定义部分（文件顶部），不动方法实现。

- [ ] **Step 1: 更新 `TabInfo` 类型**

将 `src/background/aiServive.ts` 第 12-22 行替换为：

```typescript
export type TabInfo = {
    id?: number;
    title?: string;
    url?: string;
    groupId?: number;
    windowId?: number;
    doc?: Document;
    keywords?: string[];
};
```

- [ ] **Step 2: 更新 `AiConfig` 类型，删除 `useExactMode`**

将 `src/background/aiServive.ts` 第 36-41 行替换为：

```typescript
export type AiConfig = {
    key: string,
    model: string,
    baseUrl: string,
}
```

- [ ] **Step 3: 更新 `AiProvider` 类型，删除 `useExactMode`**

将 `src/background/aiServive.ts` 第 44-52 行替换为：

```typescript
export type AiProvider = {
    id: string,
    name: string,
    key: string,
    model: string,
    baseUrl: string,
    isDefault?: boolean,
}
```

- [ ] **Step 4: 更新 `PageSummaryResult` 类型**

将 `src/background/aiServive.ts` 第 69-73 行替换为：

```typescript
export type PageSummaryResult = {
    keywords: string[];
};
```

- [ ] **Step 5: 删除顶部不再需要的 import 和全局变量**

将文件顶部第 3-10 行替换为：

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
const SUMMARY_STORAGE_KEY = 'pageSummaries';
```

- [ ] **Step 6: 验证 TypeScript 编译无报错**

```bash
cd /Users/huangzhiyuan/Desktop/front-site/chrome-ai-tab-group-plugin
npx tsc --noEmit 2>&1 | head -50
```

Expected: 有报错（因为方法实现还未更新），但报错应该只在方法体内，不在类型定义处

- [ ] **Step 7: Commit**

```bash
git add src/background/aiServive.ts
git commit -m "refactor: simplify TabInfo, AiConfig, PageSummaryResult types - remove exact mode"
```

---

## Task 3: 实现 `extractKeywords()` 函数

**Files:**
- Modify: `src/background/aiServive.ts`

- [ ] **Step 1: 在 `AiTabService` 类之前添加 `extractKeywords` 函数**

在 `src/background/aiServive.ts` 中，`export default class AiTabService` 之前插入以下代码：

```typescript
// 中文停用词列表
const STOP_WORDS = new Set([
    '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
    '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
    '自己', '这', '那', '里', '来', '他', '她', '它', '们', '与', '及', '或', '但',
    '而', '又', '如', '则', '被', '把', '让', '使', '由', '为', '以', '从', '对',
    '于', '之', '其', '此', '该', '所', '等', '中', '后', '前', '内', '外', '下',
    '可', '能', '将', '已', '并', '且', '因', '此', '故', '虽', '然', '若', '即',
    '这个', '那个', '这些', '那些', '什么', '怎么', '为什么', '如何', '哪些', '哪个',
    '时候', '现在', '时间', '方面', '问题', '情况', '进行', '通过', '使用', '提供'
]);

/**
 * 使用 segmentit 分词 + TextRank 算法提取关键词
 * @param text 已剥离 HTML 的纯文本
 * @param customWords 用户自定义词库（专有名词）
 * @returns 3-5 个关键词
 */
export function extractKeywords(text: string, customWords: string[] = []): string[] {
    try {
        if (!text || text.trim().length === 0) {
            return [];
        }

        // 动态导入 segmentit
        const { Segment, useDefault } = require('segmentit');
        const segment = useDefault(new Segment());

        // 注入自定义词库，确保专有名词不被拆分
        if (customWords.length > 0) {
            const customDict: Record<string, number> = {};
            customWords.forEach(word => {
                if (word.trim()) {
                    customDict[word.trim()] = 1; // 词性标记为名词
                }
            });
            segment.loadDict(customDict);
        }

        // 分词
        const words: string[] = segment.doSegment(text, { simple: true });

        // 过滤停用词和单字词（保留自定义词）
        const customWordSet = new Set(customWords.map(w => w.trim()));
        const filteredWords = words.filter((w: string) => {
            if (customWordSet.has(w)) return true; // 自定义词始终保留
            return w.length > 1 && !STOP_WORDS.has(w) && /[\u4e00-\u9fa5a-zA-Z]/.test(w);
        });

        if (filteredWords.length === 0) {
            return [];
        }

        // TextRank：构建词共现图
        const windowSize = 2;
        const wordSet = [...new Set(filteredWords)];
        const scores: Record<string, number> = {};
        const edges: Record<string, Set<string>> = {};

        wordSet.forEach(w => {
            scores[w] = 1.0;
            edges[w] = new Set();
        });

        // 构建共现关系
        for (let i = 0; i < filteredWords.length; i++) {
            for (let j = i + 1; j <= Math.min(i + windowSize, filteredWords.length - 1); j++) {
                const w1 = filteredWords[i]!;
                const w2 = filteredWords[j]!;
                if (w1 !== w2) {
                    edges[w1]?.add(w2);
                    edges[w2]?.add(w1);
                }
            }
        }

        // PageRank 迭代
        const dampingFactor = 0.85;
        const iterations = 10;

        for (let iter = 0; iter < iterations; iter++) {
            const newScores: Record<string, number> = {};
            wordSet.forEach(w => {
                let score = 1 - dampingFactor;
                const neighbors = edges[w];
                if (neighbors) {
                    neighbors.forEach(neighbor => {
                        const neighborEdges = edges[neighbor];
                        if (neighborEdges && neighborEdges.size > 0) {
                            score += dampingFactor * (scores[neighbor]! / neighborEdges.size);
                        }
                    });
                }
                newScores[w] = score;
            });
            Object.assign(scores, newScores);
        }

        // 按分数排序，取前 3-5 个
        const sorted = wordSet
            .sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));

        const count = Math.min(5, Math.max(sorted.length, 3));
        return sorted.slice(0, Math.min(count, sorted.length));

    } catch (error) {
        log(`[关键词提取] 提取失败: ${error}`);
        return [];
    }
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd /Users/huangzhiyuan/Desktop/front-site/chrome-ai-tab-group-plugin
npx tsc --noEmit 2>&1 | grep "extractKeywords" | head -20
```

Expected: 无与 `extractKeywords` 相关的报错

- [ ] **Step 3: Commit**

```bash
git add src/background/aiServive.ts
git commit -m "feat: add extractKeywords function using segmentit + TextRank"
```

---

## Task 4: 重写 `summarizePage()` 方法

**Files:**
- Modify: `src/background/aiServive.ts`

- [ ] **Step 1: 替换 `summarizePage()` 方法实现**

将 `src/background/aiServive.ts` 中 `summarizePage` 方法（第 183-267 行）替换为：

```typescript
/**
 * 对单个标签页进行关键词提取
 * @param tabId 标签页ID
 * @param doc 网页Document对象
 * @param customWords 用户自定义词库
 * @returns 关键词提取结果
 */
public async summarizePage(
    tabId: number,
    doc: Document,
    customWords: string[] = []
): Promise<PageSummaryResult | null> {
    try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
            log(`[关键词提取] 跳过标签页 ${tabId}: ${tab.url}`);
            return null;
        }

        log(`[关键词提取] 开始提取标签页 ${tabId}: ${tab.title}`);

        // 剥离 HTML，提取纯文本
        const body = doc.body;
        const removeTags = ['img', 'script', 'style', 'iframe', 'meta'];
        removeTags.forEach(tag => {
            const elements = body.querySelectorAll(tag);
            elements.forEach(el => el.remove());
        });
        const text = (body.textContent || '').trim().replace(/\s+/g, ' ');

        if (!text) {
            log(`[关键词提取] 标签页 ${tabId} 文本为空`);
            return { keywords: [] };
        }

        const keywords = extractKeywords(text, customWords);
        log(`[关键词提取] 标签页 ${tabId} 提取完成，关键词: ${keywords.join(', ')}`);
        return { keywords };

    } catch (error) {
        log(`[关键词提取] 标签页 ${tabId} 提取过程出错: ${error}`);
        return null;
    }
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd /Users/huangzhiyuan/Desktop/front-site/chrome-ai-tab-group-plugin
npx tsc --noEmit 2>&1 | head -50
```

Expected: 报错数量应减少，不再有与 `Readability`、`splitter`、`loadSummarizationChain` 相关的报错

- [ ] **Step 3: Commit**

```bash
git add src/background/aiServive.ts
git commit -m "feat: rewrite summarizePage to use HTML stripping + TextRank keyword extraction"
```

---

## Task 5: 重写 `group()` 方法中的 prompt 构建逻辑

**Files:**
- Modify: `src/background/aiServive.ts`

- [ ] **Step 1: 删除 `buildExactPrompt()` 方法，替换 `buildNormalPrompt()` 为 `buildPrompt()`**

删除 `buildExactPrompt()` 方法（第 124-160 行）。

将 `buildNormalPrompt()` 方法（第 86-122 行）替换为：

```typescript
private buildPrompt() {
    let prompt = "请根据以下网页标题和关键词对标签页进行智能分组。相同类型或主题的网页应该归为一组。\n";
    prompt += "待分组的标签页列表（索引从0开始）：\n";
    prompt += this.ungroupTabInfos.map((tab, index) => {
        const keywordsStr = (tab.keywords && tab.keywords.length > 0)
            ? tab.keywords.join(', ')
            : '无';
        return `${index}: 标题:${tab.title}; 关键词: [${keywordsStr}]`;
    }).join('\n\n');
    if (this.existGroup.length > 0) {
        prompt += "\n已存在的分组（如果新标签页属于某个已有分组，请将其归入该分组）：\n";
        this.existGroup.forEach(g => {
            prompt += "分组" + g.title + "包含的标签页:\n";
            g.tabDetails?.forEach(t => {
                prompt += "- " + t.title + "\n";
            });
            prompt += "\n";
        });
    }
    prompt += `请返回JSON格式的结果，格式如下：
    {
      "newGroups": {
        "分组名称1": [标签索引1, 标签索引2, ...],
        "分组名称2": [标签索引3, 标签索引4, ...]
      },
      "existingGroups": {
        "已有分组名称": [标签索引1, 标签索引2, ...]
      }
    }
    
    规则：
    1. 如果标签页可以归入已有分组，请将其放在"existingGroups"中对应的分组下
    2. 如果标签页无法归入已有分组，请创建新分组，放在"newGroups"中
    3. 分组名称应该简洁明了，能够概括该组标签的主题（2-6个中文字符）
    4. 每个分组至少包含1个标签页
    5. 所有待分组的标签页都必须被分配到一个分组中
    6. 只返回JSON，不要包含其他文字说明
    7. 只需要关注待分组的标签页
    
    请开始分析并返回JSON结果：`;
    return prompt;
}
```

- [ ] **Step 2: 更新 `sendToAi()` 的 system message**

将 `sendToAi()` 方法（第 269-275 行）替换为：

```typescript
private async sendToAi(prompt: string) {
    const response = await this.getLLMInstance().invoke([
        new SystemMessage("你是一个专业的网页标签分类助手。你需要根据网页标题和关键词对标签页进行智能分组。"),
        new HumanMessage(prompt)
    ]);
    return response.content;
}
```

- [ ] **Step 3: 重写 `group()` 方法，删除精准模式分支**

将 `group()` 方法（第 624-673 行）替换为：

```typescript
public async group(customWords: string[] = []) {
    log('[AI分组] 开始处理标签页关键词提取...');
    await Promise.all(
        this.ungroupTabInfos.map(async tab => {
            if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
                log(`[AI分组] 跳过标签页 ${tab.id}: ${tab.url}`);
                return;
            }

            log(`[AI分组] 处理标签页 ${tab.id}: ${tab.title}`);

            // 优先从 LocalStorage 读取缓存的关键词
            const savedSummary = await this.loadPageSummaryFromStorage(tab.url);
            if (savedSummary) {
                tab.keywords = savedSummary.keywords;
                log(`[AI分组] 标签页 ${tab.id} 使用缓存关键词: ${tab.keywords?.join(', ')}`);
                return;
            }

            // 没有缓存，使用 doc 实时提取
            if (tab.doc) {
                const result = await this.summarizePage(tab.id!, tab.doc, customWords);
                if (result) {
                    tab.keywords = result.keywords;
                    await this.savePageSummaryToStorage(tab.url, result);
                    log(`[AI分组] 标签页 ${tab.id} 关键词提取完成: ${tab.keywords?.join(', ')}`);
                }
            } else {
                log(`[AI分组] 标签页 ${tab.id} 无 doc，跳过关键词提取`);
            }
        })
    );

    log('[AI分组] 关键词提取完成，开始构建提示词...');
    const prompt = this.buildPrompt();
    log(prompt);
    log('[AI分组] 提示词构建完成，开始调用AI...');
    const response = await this.sendToAi(prompt);
    log('[AI分组] AI响应接收完成，开始解析...');
    const groupResult = this.parseContent(response);
    log('[AI分组] 解析完成，开始执行分组操作...');
    await this.executeGrouping(groupResult);
    log('[AI分组] 分组操作执行完成');
}
```

- [ ] **Step 4: 在 `loadPageSummaryFromStorage` 之后添加 `savePageSummaryToStorage` 私有方法**

在 `loadPageSummaryFromStorage` 方法后插入：

```typescript
private async savePageSummaryToStorage(url: string, summary: PageSummaryResult): Promise<void> {
    try {
        const result = await chrome.storage.local.get(SUMMARY_STORAGE_KEY);
        const summaries = (result[SUMMARY_STORAGE_KEY] as Record<string, { summary: PageSummaryResult }>) || {};
        summaries[url] = { summary };
        await chrome.storage.local.set({ [SUMMARY_STORAGE_KEY]: summaries });
    } catch (error) {
        log(`[AI分组] 保存关键词到缓存失败: ${error}`);
    }
}
```

- [ ] **Step 5: 验证 TypeScript 编译**

```bash
cd /Users/huangzhiyuan/Desktop/front-site/chrome-ai-tab-group-plugin
npx tsc --noEmit 2>&1 | head -50
```

Expected: 报错应大幅减少

- [ ] **Step 6: Commit**

```bash
git add src/background/aiServive.ts
git commit -m "feat: replace dual-mode prompt with single keyword-based prompt"
```

---

## Task 6: 更新 `configStorage.ts`

**Files:**
- Modify: `src/background/configStorage.ts`

- [ ] **Step 1: 删除 `saveProvider` 函数中的 `useExactMode` 参数**

将 `saveProvider` 函数签名（第 184-190 行）替换为：

```typescript
export async function saveProvider(
    providerType: ProviderType,
    key: string,
    model: string,
    isDefault: boolean
): Promise<string> {
```

- [ ] **Step 2: 删除 `providerData` 中的 `useExactMode` 字段**

将 `saveProvider` 内 `providerData` 对象（第 202-209 行）替换为：

```typescript
const providerData: Omit<AiProvider, 'id'> = {
    name: providerInfo.name,
    key,
    model,
    baseUrl: providerInfo.baseUrl,
    isDefault,
};
```

- [ ] **Step 3: 在文件末尾添加自定义词库的存取函数**

在文件末尾（`getProviderByType` 函数之后）追加：

```typescript
const CUSTOM_DICT_STORAGE_KEY = 'customDictStorage';

/**
 * 加载自定义词库
 */
export async function loadCustomDict(): Promise<string[]> {
    try {
        const result = await chrome.storage.sync.get(CUSTOM_DICT_STORAGE_KEY);
        if (result[CUSTOM_DICT_STORAGE_KEY]) {
            return (result[CUSTOM_DICT_STORAGE_KEY] as { words: string[] }).words || [];
        }
        return [];
    } catch (error) {
        console.error('加载自定义词库失败:', error);
        return [];
    }
}

/**
 * 保存自定义词库
 */
export async function saveCustomDict(words: string[]): Promise<void> {
    try {
        await chrome.storage.sync.set({ [CUSTOM_DICT_STORAGE_KEY]: { words } });
    } catch (error) {
        console.error('保存自定义词库失败:', error);
        throw error;
    }
}
```

- [ ] **Step 4: 验证 TypeScript 编译**

```bash
cd /Users/huangzhiyuan/Desktop/front-site/chrome-ai-tab-group-plugin
npx tsc --noEmit 2>&1 | grep "configStorage" | head -20
```

Expected: 无 configStorage 相关报错

- [ ] **Step 5: Commit**

```bash
git add src/background/configStorage.ts
git commit -m "refactor: remove useExactMode from configStorage, add loadCustomDict/saveCustomDict"
```

---

## Task 7: 更新 `background.ts`

**Files:**
- Modify: `src/background/background.ts`

- [ ] **Step 1: 更新 import，添加 `loadCustomDict`**

将文件顶部 import 第 4 行替换为：

```typescript
import { getDefaultProvider, getAllProviderTypes, loadCustomDict } from './configStorage';
```

- [ ] **Step 2: 更新 `groupTabs()` 中的 `aiConfig` 构建，删除 `useExactMode`**

将 `groupTabs()` 中第 201-206 行替换为：

```typescript
const aiConfig: AiConfig = {
    key: defaultProvider.key,
    model: defaultProvider.model,
    baseUrl: defaultProvider.baseUrl,
};
```

- [ ] **Step 3: 在 `groupTabs()` 中读取自定义词库并传给 `aiService.group()`**

将 `groupTabs()` 中第 209-210 行替换为：

```typescript
log('[AI分组] 步骤4: 初始化AI服务...');
const customWords = await loadCustomDict();
log('[AI分组] 自定义词库词数: ' + customWords.length);
const aiService = new AiTabService(ungroupedTabs, existingGroups, aiConfig);
await aiService.group(customWords);
```

- [ ] **Step 4: 更新 `summarizeTabWithDebounce()` 中的 `aiConfig` 构建，删除 `useExactMode`**

将 `summarizeTabWithDebounce()` 内（第 655-660 行）替换为：

```typescript
const aiConfig: AiConfig = {
    key: defaultProvider.key,
    model: defaultProvider.model,
    baseUrl: defaultProvider.baseUrl,
};
```

- [ ] **Step 5: 修复 `summarizeTabWithForceRefresh` 未定义的 bug**

在 `background.ts` 文件末尾的 `chrome.tabs.onUpdated.addListener` 之前，添加：

```typescript
/**
 * 强制刷新总结（清除缓存后重新总结）
 */
async function summarizeTabWithForceRefresh(tabId: number, url: string) {
    await removeSummaryFromCache(url);
    await summarizeTabWithDebounce(tabId, url, true);
}
```

- [ ] **Step 6: 验证 TypeScript 编译**

```bash
cd /Users/huangzhiyuan/Desktop/front-site/chrome-ai-tab-group-plugin
npx tsc --noEmit 2>&1 | head -50
```

Expected: 报错数量应显著减少，不再有 `useExactMode` 相关报错

- [ ] **Step 7: Commit**

```bash
git add src/background/background.ts
git commit -m "refactor: remove useExactMode from background.ts, pass customWords to group()"
```

---

## Task 8: 更新 `AppOptions.vue`，删除精准模式 UI，添加词库入口

**Files:**
- Modify: `src/pages/options/AppOptions.vue`

- [ ] **Step 1: 删除精准模式 checkbox**

将 `AppOptions.vue` 中第 29-38 行（`default-provider-group` div）替换为：

```html
<div class="default-provider-group">
  <label for="isDefault">
    <input type="checkbox" id="isDefault" name="isDefault" v-model="isDefault">
    <span>设为默认供应商</span>
  </label>
</div>
```

- [ ] **Step 2: 在管理区域添加自定义词库入口**

将 `AppOptions.vue` 中第 7-9 行（`management-section` div 内容）替换为：

```html
<div class="management-section">
  <router-link to="/provider-types" class="btn" style="text-decoration: none; margin-right: 12px;">管理AI供应商类型</router-link>
  <router-link to="/custom-dict" class="btn" style="text-decoration: none;">自定义词库</router-link>
</div>
```

- [ ] **Step 3: 删除 `<script setup>` 中的 `useExactMode` 相关代码**

在 `<script setup>` 中：

删除第 71 行：
```typescript
const useExactMode = ref(false)
```

将 `loadProviderConfig` 函数中第 111 行删除：
```typescript
useExactMode.value = existingProvider.useExactMode || false;
```

将 `loadProviderConfig` 函数中第 118 行删除：
```typescript
useExactMode.value = false;
```

将 `saveConfig` 函数中 `saveProvider` 调用（第 133-139 行）替换为：

```typescript
await saveProvider(
  selectedProviderType.value,
  apiKey.value,
  aiModel.value,
  isDefault.value
);
```

- [ ] **Step 4: 验证编译**

```bash
cd /Users/huangzhiyuan/Desktop/front-site/chrome-ai-tab-group-plugin
npx tsc --noEmit 2>&1 | grep "AppOptions" | head -20
```

Expected: 无 AppOptions 相关报错

- [ ] **Step 5: Commit**

```bash
git add src/pages/options/AppOptions.vue
git commit -m "refactor: remove exact mode UI from AppOptions, add custom dict link"
```

---

## Task 9: 新建 `AppCustomDict.vue` 自定义词库管理页面

**Files:**
- Create: `src/pages/options/AppCustomDict.vue`

- [ ] **Step 1: 创建 `AppCustomDict.vue`**

```vue
<template>
  <div class="container">
    <h1>自定义词库</h1>
    <p class="subtitle">添加专有名词、品牌名或技术术语，确保分词时不被拆分</p>

    <div class="add-section">
      <div class="input-row">
        <input
          type="text"
          v-model="newWord"
          placeholder="输入词语，如：Claude、OpenAI、大语言模型"
          @keyup.enter="addWord"
          class="word-input"
        />
        <button @click="addWord" class="btn">添加</button>
      </div>
      <div v-if="addError" class="status error">{{ addError }}</div>
    </div>

    <div class="words-section">
      <h2>已添加的词语（{{ words.length }} 个）</h2>
      <div v-if="words.length === 0" class="empty-tip">暂无自定义词语</div>
      <div v-else class="words-list">
        <div v-for="(word, index) in words" :key="index" class="word-item">
          <span class="word-text">{{ word }}</span>
          <button @click="removeWord(index)" class="btn-remove">删除</button>
        </div>
      </div>
    </div>

    <div v-if="statusMessage" :class="['status', statusType]">
      {{ statusMessage }}
    </div>

    <div style="margin-top: 20px;">
      <router-link to="/">← 返回设置</router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { loadCustomDict, saveCustomDict } from '../../background/configStorage';

const words = ref<string[]>([]);
const newWord = ref('');
const addError = ref('');
const statusMessage = ref('');
const statusType = ref<'success' | 'error'>('success');

async function loadWords() {
  try {
    words.value = await loadCustomDict();
  } catch (error) {
    showStatus('加载词库失败: ' + (error as Error).message, 'error');
  }
}

async function addWord() {
  const word = newWord.value.trim();
  addError.value = '';

  if (!word) {
    addError.value = '请输入词语';
    return;
  }
  if (words.value.includes(word)) {
    addError.value = '该词语已存在';
    return;
  }

  words.value.push(word);
  newWord.value = '';

  try {
    await saveCustomDict(words.value);
    showStatus('已添加: ' + word, 'success');
  } catch (error) {
    words.value.pop();
    showStatus('保存失败: ' + (error as Error).message, 'error');
  }
}

async function removeWord(index: number) {
  const removed = words.value.splice(index, 1)[0];
  try {
    await saveCustomDict(words.value);
    showStatus('已删除: ' + removed, 'success');
  } catch (error) {
    words.value.splice(index, 0, removed!);
    showStatus('删除失败: ' + (error as Error).message, 'error');
  }
}

function showStatus(message: string, type: 'success' | 'error') {
  statusMessage.value = message;
  statusType.value = type;
  setTimeout(() => {
    statusMessage.value = '';
  }, 3000);
}

onMounted(async () => {
  await loadWords();
});
</script>

<style scoped>
.add-section {
  margin-bottom: 30px;
}

.input-row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.word-input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.word-input:focus {
  border-color: #667eea;
}

.words-section h2 {
  font-size: 16px;
  color: #333;
  margin-bottom: 12px;
}

.empty-tip {
  color: #999;
  font-size: 14px;
  padding: 20px 0;
}

.words-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.word-item {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #f0f2ff;
  border: 1px solid #d0d5f0;
  border-radius: 20px;
  padding: 6px 12px;
}

.word-text {
  font-size: 14px;
  color: #333;
}

.btn-remove {
  background: none;
  border: none;
  color: #999;
  cursor: pointer;
  font-size: 12px;
  padding: 0 2px;
  transition: color 0.2s;
}

.btn-remove:hover {
  color: #dc3545;
}

.status {
  margin-top: 16px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 14px;
}

.status.success {
  background: #d4edda;
  color: #155724;
  border: 1px solid #c3e6cb;
}

.status.error {
  background: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/options/AppCustomDict.vue
git commit -m "feat: add AppCustomDict.vue for custom dictionary management"
```

---

## Task 10: 注册 `/custom-dict` 路由

**Files:**
- Modify: `src/pages/options/router.ts`

- [ ] **Step 1: 更新 `router.ts`**

将 `src/pages/options/router.ts` 全部内容替换为：

```typescript
import { createRouter, createWebHistory } from "vue-router";

import AppOptions from "./AppOptions.vue";
import AppProviderTypes from "./AppProviderTypes.vue";
import Privacy from "./Privacy.vue";
import AppCustomDict from "./AppCustomDict.vue";

const routes = [
    { path: "/", component: AppOptions },
    { path: "/provider-types", component: AppProviderTypes },
    { path: "/privacy", component: Privacy },
    { path: "/custom-dict", component: AppCustomDict },
]

const router = createRouter({
    history: createWebHistory(),
    routes
})

export default router
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd /Users/huangzhiyuan/Desktop/front-site/chrome-ai-tab-group-plugin
npx tsc --noEmit 2>&1 | head -50
```

Expected: 编译通过或仅剩少量非本次改动引入的报错

- [ ] **Step 3: Commit**

```bash
git add src/pages/options/router.ts
git commit -m "feat: register /custom-dict route"
```

---

## Task 11: 构建验证

**Files:**
- No file changes

- [ ] **Step 1: 执行完整构建**

```bash
cd /Users/huangzhiyuan/Desktop/front-site/chrome-ai-tab-group-plugin
npm run build 2>&1 | tail -30
```

Expected: 构建成功，输出 `dist/` 目录，无 ERROR 级别报错

- [ ] **Step 2: 检查 dist 目录是否生成**

```bash
ls /Users/huangzhiyuan/Desktop/front-site/chrome-ai-tab-group-plugin/dist/
```

Expected: 目录存在，包含 `manifest.json` 和 JS/CSS 文件

- [ ] **Step 3: 如有构建报错，排查并修复**

常见问题：
- `segmentit` 使用了 `require()`：若 Vite 报错，改为静态 import：
  ```typescript
  import { Segment, useDefault } from 'segmentit';
  ```
  并在 `extractKeywords` 函数顶部直接使用（不用 `require()`）
- 类型报错：检查 `TabInfo.doc` 是否在 `group()` 中正确传递

- [ ] **Step 4: Commit 修复（如有）**

```bash
git add -A
git commit -m "fix: resolve build errors after keyword extraction refactor"
```

---

## 自检：Spec 覆盖确认

| Spec 要求 | 对应 Task |
|-----------|-----------|
| 删除精准分类模式所有功能 | Task 2, 4, 5, 6, 7, 8 |
| segmentit 中文分词 + TextRank 提取 3-5 关键词 | Task 1, 3 |
| 支持自定义词库注入 segmentit | Task 3, 6 |
| LLM 分组时传递 title + keywords | Task 5 |
| configStorage 删除 useExactMode | Task 6 |
| Options UI 删除精准模式开关 | Task 8 |
| 新建 AppCustomDict.vue 词库管理页面 | Task 9 |
| 注册 /custom-dict 路由 | Task 10 |
| 修复 summarizeTabWithForceRefresh 未定义 bug | Task 7 |
