const DEBUG = true;

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
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

export default class AiTabService {
    private ungroupTabInfos: TabInfo[];
    private existGroup: GroupInfo[];
    private aiConfig: AiConfig;

    constructor(ungroupTabInfos: TabInfo[], existGroup: GroupInfo[], aiConfig: AiConfig) {
        this.ungroupTabInfos = ungroupTabInfos;
        this.existGroup = existGroup;
        this.aiConfig = aiConfig;
    }

    private buildNormalPrompt() {
        let prompt = "请根据以下网页标题和网页摘要(首段摘要和页面中间摘要)对标签页进行智能分组。相同类型或主题的网页应该归为一组。\n";
        prompt += "待分组的标签页标题与摘要列表（索引从0开始）：\n";
        prompt += this.ungroupTabInfos.map((tab, index) => `${index}: 标题:${tab.title}; 摘要: 【首段摘要如下】=>${tab.headText} 【页面中间摘要如下】=>${tab.bodyText}`).join('\n\n');
        if (this.existGroup.length > 0) {
            prompt += "已存在的分组（如果新标签页属于某个已有分组，请将其归入该分组）：\n";
            this.existGroup.forEach(g => {
                prompt += "分组" + g.title + "包含的标签页:\n";
                g.tabDetails?.forEach(t => {
                    prompt += "- " + t.title + "\n";
                })
                prompt += "\n";
            })
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

    private buildExactPrompt() {
        let prompt = "请根据以下网页标题和网页摘要(首段摘要和页面中间摘要)对标签页进行智能分组。相同类型或主题的网页应该归为一组。\n";
        prompt += "待分组的标签页标题与摘要列表（索引从0开始）：\n";
        prompt += this.ungroupTabInfos.map((tab, index) => `${index}: 标题:${tab.title}; 摘要: ${tab.summary}`).join('\n\n');
        if (this.existGroup.length > 0) {
            prompt += "已存在的分组（如果新标签页属于某个已有分组，请将其归入该分组）：\n";
            this.existGroup.forEach(g => {
                prompt += "分组" + g.title + "包含的标签页:\n";
                g.tabDetails?.forEach(t => {
                    prompt += "- " + t.title + "\n";
                })
                prompt += "\n";
            })
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
     * 对单个标签页进行网页总结
     * @param tabId 标签页ID
     * @param doc 网页Document对象
     * @returns 总结结果
     */
    public async summarizePage(
        tabId: number,
        doc: Document
    ): Promise<PageSummaryResult | null> {
        try {
            // 跳过 chrome:// 和 chrome-extension:// 页面
            const tab = await chrome.tabs.get(tabId);
            if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
                log(`[网页总结] 跳过标签页 ${tabId}: ${tab.url}`);
                return null;
            }

            log(`[网页总结] 开始总结标签页 ${tabId}: ${tab.title}`);

            if (this.aiConfig.useExactMode) {
                log(`[网页总结] 使用精准模式，总结全文`);
                try {
                    const reader = new Readability(doc);
                    const article = reader.parse();
                    const textContent = article?.textContent ?? '';
                    
                   const chunkContent = await splitter.createDocuments([article?.textContent ?? '']);
                    const chain = loadSummarizationChain(this.getLLMInstance(), {
                        type: 'map_reduce',
                        verbose: DEBUG,
                    });
                    const response = await chain.invoke({
                        input_documents: chunkContent,
                    });
                    log(`[网页总结] 标签页 ${tabId} 总结完成`);
                    return {
                        summary: response.text
                    };
                } catch (error) {
                    log(`[网页总结] 标签页 ${tabId} 网页总结失败: ${error}`);
                    return null;
                }
            } else {
                log(`[网页总结] 使用普通模式，利用部分段落`);
                try {
                    const body = doc.body;
                    const removeTags = ['img', 'script', 'style', 'iframe', 'meta'];
                    removeTags.forEach(tag => {
                        const elements = body.querySelectorAll(tag);
                        elements.forEach(el => el.remove());
                    });
                    const splitResult: string[] = await splitter.splitText((body.textContent || '').trim().replace(/\s+/g, ' '));
                    log(`[网页总结] 标签页 ${tabId} 分割结果数量: ${splitResult.length}`);

                    if (splitResult.length == 0) {
                        return null;
                    }

                    let headText: string;
                    let bodyText: string;

                    if (splitResult.length == 1) {
                        headText = splitResult[0] ?? '';
                        bodyText = splitResult[0] ?? '';
                    } else if (splitResult.length == 2) {
                        headText = splitResult[0] ?? '';
                        bodyText = splitResult[1] ?? '';
                    } else {
                        // 当分割结果大于2时，取第一段作为首段，取中间段作为中间摘要
                        const mid = Math.floor(splitResult.length / 2);
                        const extractMidText = (splitResult[mid - 1] ?? '') + (splitResult[mid] ?? '') + (splitResult[mid + 1] ?? '');
                        headText = splitResult[0] ?? '';
                        bodyText = extractMidText;
                    }

                    log(`[网页总结] 标签页 ${tabId} 总结完成`);
                    return {
                        headText: headText,
                        bodyText:bodyText
                    };
                } catch (error) {
                    log(`[网页总结] 标签页 ${tabId} 文本分割失败: ${error}`);
                    return null;
                }
            }
        } catch (error) {
            log(`[网页总结] 标签页 ${tabId} 总结过程出错: ${error}`);
            return null;
        }
    }

    private async sendToAi(prompt: string) {
        const response = await this.getLLMInstance().invoke([
            new SystemMessage("你是一个专业的网页标签分类助手。你需要根据网页标题对标签页进行智能分组。"),
            new HumanMessage(prompt)
        ])
        return response.content
    }

    private parseContent(content: any) {
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

    /**
     * 从 LocalStorage 读取网页总结结果
     */
    private async loadPageSummaryFromStorage(url: string): Promise<PageSummaryResult | null> {
        try {
            const result = await chrome.storage.local.get(SUMMARY_STORAGE_KEY);
            const summaries = (result[SUMMARY_STORAGE_KEY] as Record<string, { summary: PageSummaryResult }>) || {};
            const summaryData = summaries[url];
            if (summaryData && summaryData.summary) {
                log(`[AI分组] 从 LocalStorage 读取到标签页 ${url} 的总结结果`);
                return summaryData.summary;
            }
            return null;
        } catch (error) {
            log(`[AI分组] 从 LocalStorage 读取总结结果失败: ${error}`);
            return null;
        }
    }

    public async group() {
        log('[AI分组] 开始处理标签页文本处理...');
        await Promise.all(
            this.ungroupTabInfos.map(async tab => {
                // 跳过 chrome:// 和 chrome-extension:// 页面
                if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
                    log(`[AI分组] 跳过标签页 ${tab.id}: ${tab.url}`);
                    return;
                }

                log(`[AI分组] 处理标签页 ${tab.id}: ${tab.title}`);

                // 优先从 LocalStorage 读取总结结果
                const savedSummary = await this.loadPageSummaryFromStorage(tab.url);
                if (savedSummary) {
                    // 如果从 LocalStorage 读取到了总结结果，直接使用
                    if (this.aiConfig.useExactMode) {
                        tab.summary = savedSummary.summary;
                    } else {
                        tab.headText = savedSummary.headText;
                        tab.bodyText = savedSummary.bodyText;
                    }
                    log(`[AI分组] 标签页 ${tab.id} 使用 LocalStorage 中的总结结果`);
                    return;
                }

                // 如果没有保存的总结结果，跳过该标签页（不进行新的总结）
                // 因为用户点击分组时，如果选择"使用已有结果继续"，应该只处理有总结结果的标签页
                log(`[AI分组] 标签页 ${tab.id} 没有保存的总结结果，跳过（不进行分组）`);
                return;
            })
        );

        log('[AI分组] 文本分割完成，开始构建提示词...');
        let prompt = '';
        if (this.aiConfig.useExactMode) {
            prompt = this.buildExactPrompt();
        } else {
            prompt = this.buildNormalPrompt();
        }
        log(prompt)
        log('[AI分组] 提示词构建完成，开始调用AI...');
        const response = await this.sendToAi(prompt);
        log('[AI分组] AI响应接收完成，开始解析...');
        const groupResult = this.parseContent(response);
        log('[AI分组] 解析完成，开始执行分组操作...');
        await this.executeGrouping(groupResult);
        log('[AI分组] 分组操作执行完成');

    }
}
