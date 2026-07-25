const DEBUG = false;

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Segment, useDefault } from 'segmentit';
const SUMMARY_STORAGE_KEY = 'pageSummaries';

export type TabInfo = {
    id?: number;
    title?: string;
    url?: string;
    groupId?: number;
    windowId?: number;
    doc?: Document;
    keywords?: string[];
};

export type GroupInfo = {
    id?: number;
    title?: string;
    color?: string;
    tabDetails?: Array<{ id?: number; title?: string }>;
};

type AiGroupResult = {
    newGroups: Record<string, number[]>,
    existingGroups: Record<string, number[]>
}

export type AiConfig = {
    key: string,
    model: string,
    baseUrl: string,
}

// AI供应商配置
export type AiProvider = {
    id: string,
    name: string,
    key: string,
    model: string,
    baseUrl: string,
    isDefault?: boolean,
}

// 存储所有AI供应商配置
export type AiConfigStorage = {
    providers: AiProvider[],
    defaultProviderId?: string  // 默认供应商ID
}

export function log(msg: any) {
    if (DEBUG) {
        console.log(msg)
    }
}

export type PageSummaryResult = {
    keywords: string[];
};

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

        // 使用 segmentit 进行中文分词
        const segment = useDefault(new Segment());

        // 注入自定义词库，确保专有名词不被拆分
        if (customWords.length > 0) {
            const dictStr = customWords
                .filter(w => w.trim())
                .map(w => `${w}|0x00000080|9999`)
                .join('\n');
            log('已加载自定义词库: ' + dictStr);
            segment.loadDict(dictStr);
        }

        // 分词
        const words: string[] = segment.doSegment(text, { simple: true, stripPunctuation:true, stripStopword:true, convertSynonym:true });
        //log('分词结果: ' + words.join(', '));

        // 过滤停用词和单字词（保留自定义词）
        const customWordSet = new Set(customWords.map(w => w.trim()));
        const filteredWords = words.filter((w: string) => {
            if (customWordSet.has(w)) return true;
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
        const sorted = wordSet.sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));

        return sorted.slice(0, Math.min(5, sorted.length));

    } catch (error) {
        log(`[关键词提取] 提取失败: ${error}`);
        return [];
    }
}

export default class AiTabService {
    private ungroupTabInfos: TabInfo[];
    private existGroup: GroupInfo[];
    private aiConfig: AiConfig;

    constructor(ungroupTabInfos: TabInfo[], existGroup: GroupInfo[], aiConfig: AiConfig) {
        this.ungroupTabInfos = ungroupTabInfos;
        this.existGroup = existGroup;
        this.aiConfig = aiConfig;
    }

    private buildPrompt() {
        let prompt = "请根据以下网页标题和关键词对标签页进行分组。相同类型或主题的网页应该归为一组。\n";
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
                prompt += "分组" + g.title + "\n";
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
    4. 所有待分组的标签页都必须被分配到一个分组中
    5. 只返回JSON，不要包含其他文字说明
    6. 只需要关注待分组的标签页

    请开始分析并返回JSON结果：`;
        return prompt;
    }

    private getLLMInstance() {
        const chat = new ChatOpenAI(
            {
                model: this.aiConfig.model,
                temperature: 0.3,
                streaming: false,
                apiKey: this.aiConfig.key,
                configuration: {
                    baseURL: this.aiConfig.baseUrl,
                }
            }
        );
        return chat;
    }

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
        customWords?: string[] | null
    ): Promise<PageSummaryResult | null> {
        // 确保 customWords 是数组类型
        const safeCustomWords = Array.isArray(customWords) ? customWords : [];
        try {
            const tab = await chrome.tabs.get(tabId);
            if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
                log(`[关键词提取] 跳过标签页 ${tabId}: ${tab.url}`);
                return null;
            }

            log(`[关键词提取] 开始提取标签页 ${tabId}: ${tab.title}`);

            // 使用正则表达式提取纯文本，保留段落结构
            let htmlContent = doc.body.innerHTML;

            // 移除 script 和 style 标签及其内容
            htmlContent = htmlContent.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
            htmlContent = htmlContent.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

            // 移除 HTML 注释
            htmlContent = htmlContent.replace(/<!--[\s\S]*?-->/g, '');

            // 移除常见的非内容标签（只移除标签，保留可能的内容）
            htmlContent = htmlContent.replace(/<(img|iframe|meta|link|svg|path|symbol|use)[^>]*\/?>/gi, '');

            // 将块级元素转换为换行符（保留段落结构）
            // 常见的块级元素：div, p, h1-h6, br, li, tr, blockquote, pre, hr 等
            htmlContent = htmlContent.replace(/<\/(div|p|h[1-6]|br|li|tr|blockquote|pre|hr|section|article|header|footer|nav|aside|main|figure|figcaption|details|summary)[^>]*>/gi, '\n');
            htmlContent = htmlContent.replace(/<br\s*\/?>/gi, '\n');

            // 移除所有剩余的HTML标签
            htmlContent = htmlContent.replace(/<[^>]+>/g, '');

            // 解码HTML实体
            htmlContent = htmlContent.replace(/&nbsp;/g, ' ');
            htmlContent = htmlContent.replace(/&amp;/g, '&');
            htmlContent = htmlContent.replace(/&lt;/g, '<');
            htmlContent = htmlContent.replace(/&gt;/g, '>');
            htmlContent = htmlContent.replace(/&quot;/g, '"');
            htmlContent = htmlContent.replace(/&#39;/g, "'");
            htmlContent = htmlContent.replace(/&#[\d]+;/g, (match) => {
                const code = parseInt(match.slice(2, -1));
                return String.fromCharCode(code);
            });

            // 移除URL（http/https/ftp/mailto等）
            htmlContent = htmlContent.replace(/https?:\/\/[^\s<>"]+/g, '');
            htmlContent = htmlContent.replace(/ftp:\/\/[^\s<>"]+/g, '');
            htmlContent = htmlContent.replace(/mailto:[^\s<>"]+/g, '');

            // 清理空白字符，但保留换行符
            let text = htmlContent
                .split('\n')
                .map(line => line.trim().replace(/[ \t]+/g, ' ').trim())  // 每行内部合并空格
                .filter(line => line.length > 0)  // 移除空行
                .join('\n');  // 用换行符连接非空行

            // 最终清理：确保没有多余的连续换行
            text = text.replace(/\n{3,}/g, '\n\n');  // 最多保留两个连续换行

            log(`[关键词提取] 文本提取完成，长度: ${text.length}, 行数: ${text.split('\n').length}`);

            if (!text) {
                log(`[关键词提取] 标签页 ${tabId} 文本为空`);
                return { keywords: [] };
            }

            const keywords = extractKeywords(text, safeCustomWords);
            return { keywords };

        } catch (error) {
            log(`[关键词提取] 标签页 ${tabId} 提取过程出错: ${error}`);
            return null;
        }
    }

    private async sendToAi(prompt: string) {
        const response = await this.getLLMInstance().invoke([
            new SystemMessage("你是一个专业的网页标签分类助手。你需要根据网页标题和关键词对标签页进行智能分组。"),
            new HumanMessage(prompt)
        ]);
        return response.content;
    }

    private parseContent(content: unknown) {
        if (typeof content !== 'string') {
            throw new Error(`解析AI响应失败: 响应内容不是字符串类型 (${typeof content})`);
        }
        let jsonStr = content.trim();
        // 移除可能的markdown代码块标记
        if (jsonStr.startsWith('```')) {
            const lines = jsonStr.split('\n');
            const startIdx = lines.findIndex((line: string) => line.trim().startsWith('```'));
            const endIdx = lines.findIndex((line: string, idx: number) => idx > startIdx && line.trim().startsWith('```'));
            if (startIdx >= 0 && endIdx > startIdx) {
                jsonStr = lines.slice(startIdx + 1, endIdx).join('\n');
            }
        }
        // 尝试提取JSON对象
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            jsonStr = jsonMatch[0];
            log('已提取JSON对象');
        }

        log('准备解析的JSON字符串:' + jsonStr.substring(0, 500));

        try {
            const result = JSON.parse(jsonStr);
            log('JSON解析成功');

            // 验证结果格式
            if (!result.newGroups && !result.existingGroups) {
                console.error('❌ 返回格式不正确，缺少newGroups或existingGroups');
                throw new Error('返回格式不正确');
            }

            const parsedResult = {
                newGroups: result.newGroups || {},
                existingGroups: result.existingGroups || {}
            };

            log('✅ 解析完成，新分组数:' + Object.keys(parsedResult.newGroups).length);
            log('✅ 已有分组更新数:' + Object.keys(parsedResult.existingGroups).length);

            return parsedResult;
        } catch (error: any) {
            console.error('❌ 解析AI响应失败:', error);
            throw new Error(`解析AI响应失败: ${error.message}`);
        }
    }

    // 验证标签页是否在普通窗口中
    private async validateTabsInNormalWindow(tabIds: number[]): Promise<number[]> {
        if (tabIds.length === 0) {
            return [];
        }

        // 获取所有普通窗口
        const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
        const windowIds = windows
            .map(w => w.id)
            .filter((id): id is number => id !== undefined);

        if (windowIds.length === 0) {
            log(`[AI分组] ⚠️ 没有普通窗口，无法验证标签页`);
            return [];
        }

        // 获取这些标签页的详细信息（实时查询）
        const tabs = await chrome.tabs.query({});
        const tabsInfo = tabs.filter(t => t.id !== undefined && tabIds.includes(t.id));

        // 过滤出在普通窗口中的标签页，并且未被分组的标签页
        const validTabIds = tabsInfo
            .filter(tab => {
                // 检查窗口类型
                if (tab.windowId === undefined || !windowIds.includes(tab.windowId)) {
                    log(`[AI分组] ⚠️ 标签页 ${tab.id} 不在普通窗口中 (windowId: ${tab.windowId})`);
                    return false;
                }
                // 检查是否已经被分组（如果已经有分组ID且不是 TAB_GROUP_ID_NONE，则跳过）
                if (tab.groupId !== undefined && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
                    log(`[AI分组] ⚠️ 标签页 ${tab.id} 已经被分组 (groupId: ${tab.groupId})`);
                    return false;
                }
                return true;
            })
            .map(tab => tab.id)
            .filter((id): id is number => id !== undefined);

        if (validTabIds.length < tabIds.length) {
            const invalidCount = tabIds.length - validTabIds.length;
            log(`[AI分组] ⚠️ 过滤掉${invalidCount}个无效的标签页（不在普通窗口或已被分组）`);
        }

        return validTabIds;
    }



    // 执行分组操作
    private async executeGrouping(groupResult: AiGroupResult) {
        log('[AI分组] 开始执行分组操作...');

        // 先处理添加到已有分组的情况
        const existingGroupsToUpdate = Object.entries(groupResult.existingGroups || {});
        log('[AI分组] 需要添加到已有分组的数量:' + existingGroupsToUpdate.length);


        for (const [groupName, tabIndices] of existingGroupsToUpdate) {
            log(`[AI分组] 处理已有分组"${groupName}" + 标签索引:` + tabIndices);
            const existingGroup = this.existGroup.find(g => g.title === groupName);
            if (existingGroup && tabIndices.length > 0) {
                const tabIds = tabIndices
                    .map(idx => this.ungroupTabInfos[idx]?.id)
                    .filter((id): id is number => id !== undefined);
                log(`[AI分组] 添加到分组"${groupName}"的标签ID:` + tabIds);

                // 验证标签页是否在普通窗口中
                const validTabIds = await this.validateTabsInNormalWindow(tabIds);
                if (validTabIds.length === 0) {
                    log(`[AI分组] ⚠️ 分组"${groupName}"的所有标签都不在普通窗口中，跳过`);
                    continue;
                }

                // 获取该分组中已有的标签ID
                const existingTabIds = (await chrome.tabs.query({ groupId: existingGroup.id })).map(t => t.id).filter((id): id is number => id !== undefined);;
                log(`[AI分组] 分组"${groupName}"已有标签ID:` + existingTabIds);

                // 将所有标签ID合并（包括已有和新添加的）
                const allTabIds = [...existingTabIds, ...validTabIds];
                if (allTabIds.length === 0) {
                    log(`[AI分组] ⚠️ 分组"${groupName}"没有有效标签，跳过`);
                    continue;
                }

                // 检查所有标签页是否在同一个窗口中（Chrome API 要求）
                const tabs = await chrome.tabs.query({});
                const tabsInfo = tabs.filter(t => t.id !== undefined && allTabIds.includes(t.id));
                const windowIds = tabsInfo.map(t => t.windowId).filter((id): id is number => id !== undefined);
                const uniqueWindowIds = [...new Set(windowIds)];

                if (uniqueWindowIds.length > 1) {
                    log(`[AI分组] ⚠️ 分组"${groupName}"的标签页分布在多个窗口中，需要按窗口分组`);
                    // 按窗口分组，但保持分组名称一致
                    for (const windowId of uniqueWindowIds) {
                        const tabsInWindow = tabsInfo
                            .filter(t => t.windowId === windowId)
                            .map(t => t.id)
                            .filter((id): id is number => id !== undefined);

                        if (tabsInWindow.length > 0) {
                            // 对每个窗口的标签页再次验证
                            const verifiedTabsInWindow = await this.validateTabsInNormalWindow(tabsInWindow);
                            if (verifiedTabsInWindow.length === 0) {
                                log(`[AI分组] ⚠️ 窗口 ${windowId} 的标签页验证失败，跳过`);
                                continue;
                            }
                            try {
                                const groupId = await chrome.tabs.group({ tabIds: verifiedTabsInWindow as [number, ...number[]] });
                                await chrome.tabGroups.update(groupId, {
                                    title: groupName,
                                    color: this.getRandomColor()
                                });
                                log(`[AI分组] ✅ 已添加到分组"${groupName}"（窗口 ${windowId}，${verifiedTabsInWindow.length}个标签）`);
                            } catch (error: any) {
                                console.error(`[AI分组] ❌ 添加到分组"${groupName}"失败（窗口 ${windowId}）:`, error);
                            }
                        }
                    }
                    continue;
                }

                // 所有标签页在同一窗口中，可以合并分组
                log(`[AI分组] 合并标签到分组"${groupName}"，总标签数:` + allTabIds.length);
                try {
                    const groupId = await chrome.tabs.group({ tabIds: allTabIds as [number, ...number[]] });
                    await chrome.tabGroups.update(groupId, {
                        title: groupName,
                        color: existingGroup.color as chrome.tabGroups.Color | undefined
                    });
                    log(`[AI分组] ✅ 已添加到分组"${groupName}"`);
                } catch (error: any) {
                    console.error(`[AI分组] ❌ 添加到分组"${groupName}"失败:`, error);
                    console.error(`[AI分组] 失败的标签ID:`, allTabIds);
                    // 获取标签页详细信息以便调试
                    try {
                        const failedTabs = await Promise.all(
                            allTabIds.map(async (tabId) => {
                                try {
                                    const tab = await chrome.tabs.get(tabId);
                                    const window = await chrome.windows.get(tab.windowId);
                                    return {
                                        id: tab.id,
                                        windowId: tab.windowId,
                                        windowType: window.type,
                                        url: tab.url,
                                        groupId: tab.groupId
                                    };
                                } catch (e) {
                                    return {
                                        id: tabId,
                                        error: `无法获取标签页信息: ${e}`
                                    };
                                }
                            })
                        );
                        console.error(`[AI分组] 失败的标签页详细信息:`, failedTabs);
                    } catch (debugError) {
                        console.error(`[AI分组] 获取失败标签页信息时出错:`, debugError);
                    }
                }
            } else {
                log(`[AI分组] ⚠️ 未找到分组"${groupName}"或标签索引为空`);
            }
        }


        // 创建新分组
        const newGroupsToCreate = Object.entries(groupResult.newGroups || {});
        log('[AI分组] 需要创建的新分组数量:' + newGroupsToCreate.length);

        for (const [groupName, tabIndices] of newGroupsToCreate) {
            log(`[AI分组] 创建新分组"${groupName}"，标签索引:` + tabIndices);
            if (tabIndices.length > 0) {
                const tabIds = tabIndices.map(idx => this.ungroupTabInfos[idx]?.id)
                    .filter((id): id is number => id !== undefined);;
                log(`[AI分组] 新分组"${groupName}"的标签ID:` + tabIds);

                // 过滤掉已经添加到已有分组的标签
                const tabsToGroup = tabIds.filter(tabId => {
                    // 检查这个标签是否已经被添加到已有分组
                    return !Object.values(groupResult.existingGroups || {}).some(indices =>
                        indices.some(idx => this.ungroupTabInfos[idx]?.id === tabId)
                    );
                });

                log(`[AI分组] 过滤后的标签ID（排除已分组）:` + tabsToGroup);

                // 验证标签页是否在普通窗口中
                const validTabsToGroup = await this.validateTabsInNormalWindow(tabsToGroup);
                if (validTabsToGroup.length === 0) {
                    log(`[AI分组] ⚠️ 新分组"${groupName}"的所有标签都不在普通窗口中，跳过`);
                    continue;
                }

                if (validTabsToGroup.length > 0) {
                    log(`[AI分组] 创建新分组"${groupName}"，包含${validTabsToGroup.length}个标签`);

                    // 检查所有标签页是否在同一个窗口中（Chrome API 要求）
                    const tabs = await chrome.tabs.query({});
                    const tabsInfo = tabs.filter(t => t.id !== undefined && validTabsToGroup.includes(t.id));
                    const windowIds = tabsInfo.map(t => t.windowId).filter((id): id is number => id !== undefined);
                    const uniqueWindowIds = [...new Set(windowIds)];

                    if (uniqueWindowIds.length > 1) {
                        log(`[AI分组] ⚠️ 新分组"${groupName}"的标签页分布在多个窗口中，需要按窗口分组`);
                        // 按窗口分组
                        for (const windowId of uniqueWindowIds) {
                            const tabsInWindow = tabsInfo
                                .filter(t => t.windowId === windowId)
                                .map(t => t.id)
                                .filter((id): id is number => id !== undefined);

                            if (tabsInWindow.length > 0) {
                                try {
                                    const groupId = await chrome.tabs.group({ tabIds: validTabsToGroup as [number, ...number[]] });
                                    await chrome.tabGroups.update(groupId, {
                                        title: groupName,
                                        color: this.getRandomColor()
                                    });
                                    log(`[AI分组] ✅ 已创建新分组"${groupName}"（窗口 ${windowId}，${validTabsToGroup.length}个标签）`);
                                } catch (error: any) {
                                    console.error(`[AI分组] ❌ 创建新分组"${groupName}"失败（窗口 ${windowId}）:`, error);
                                }
                            }
                        }
                        continue;
                    }

                    // 所有标签页在同一窗口中，可以创建分组
                    try {
                        const groupId = await chrome.tabs.group({ tabIds: validTabsToGroup as [number, ...number[]] });
                        log(`[AI分组] 新分组ID:` + groupId);
                        await chrome.tabGroups.update(groupId, {
                            title: groupName,
                            color: this.getRandomColor()
                        });
                        log(`[AI分组] ✅ 已创建新分组"${groupName}"`);
                    } catch (error: any) {
                        console.error(`[AI分组] ❌ 创建新分组"${groupName}"失败:`, error);
                        // 获取标签页详细信息以便调试
                        try {
                            const failedTabs = await Promise.all(
                                validTabsToGroup.map(async (tabId) => {
                                    try {
                                        const tab = await chrome.tabs.get(tabId);
                                        const window = await chrome.windows.get(tab.windowId);
                                        return {
                                            id: tab.id,
                                            windowId: tab.windowId,
                                            windowType: window.type,
                                            url: tab.url,
                                            groupId: tab.groupId
                                        };
                                    } catch (e) {
                                        return {
                                            id: tabId,
                                            error: `无法获取标签页信息: ${e}`
                                        };
                                    }
                                })
                            );
                            console.error(`[AI分组] 失败的标签页详细信息:`, failedTabs);
                        } catch (debugError) {
                            console.error(`[AI分组] 获取失败标签页信息时出错:`, debugError);
                        }
                    }
                } else {
                    log(`[AI分组] ⚠️ 新分组"${groupName}"的标签都已分组，跳过`);
                }
            }
        }

        log('[AI分组] 分组操作执行完成');
    }

    // 获取随机颜色
    private getRandomColor(): chrome.tabGroups.Color {
        const colors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'] as const;
        const randomIndex = Math.floor(Math.random() * colors.length);
        return colors[randomIndex] as chrome.tabGroups.Color;
    }

    public async group(customWords: string[] = []) {
        log('[AI分组] 开始处理标签页关键词提取...');
        await Promise.all(
            this.ungroupTabInfos.map(async tab => {
                if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
                    log(`[AI分组] 跳过标签页 ${tab.id}: ${tab.url}`);
                    return;
                }

                // 使用 doc 实时提取
                if (tab.doc) {
                    const result = await this.summarizePage(tab.id!, tab.doc, customWords);
                    if (result) {
                        tab.keywords = result.keywords;
                    }
                    log(`[AI分组] 处理标签页 ${tab.id}: ${tab.title}, 关键词: ${tab.keywords?.join(', ')}`);
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
        log(response);
        log('[AI分组] AI响应接收完成，开始解析...');
        const groupResult = this.parseContent(response);
        log('[AI分组] 解析完成，开始执行分组操作...');
        await this.executeGrouping(groupResult);
        log('[AI分组] 分组操作执行完成');
    }
}
