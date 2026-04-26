import AiTabService from './aiServive'
import { log, type PageSummaryResult } from './aiServive';
import type { TabInfo, GroupInfo, AiConfig } from './aiServive';
import { getDefaultProvider, getAllProviderTypes } from './configStorage';
import { parseHTML } from 'linkedom';
const TAB_HTML_TIMEOUT = 5000; // 5秒超时
const SUMMARY_DEBOUNCE_DELAY = 2000; // 防抖延迟：2秒
const SUMMARY_STORAGE_KEY = 'pageSummaries'; // LocalStorage 存储键名

// 获取所有标签页信息（只获取普通窗口中的标签页）
async function getAllTabs() {
    // 先获取所有普通窗口
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
    const windowIds = windows.map(w => w.id);
    log('[AI分组] 普通窗口数量:' + windowIds.length + '窗口ID:' + windowIds);

    // 查询所有标签页
    const tabs = await chrome.tabs.query({});

    // 过滤出普通窗口中的标签页
    const normalTabs = tabs.filter(tab => {
        // 检查标签页是否在普通窗口中
        return windowIds.includes(tab.windowId);
    });

    log('[AI分组] 总标签页数:' + tabs.length + '普通窗口标签页数:' + normalTabs.length);

    log('[AI分组] 开始获取所有标签页的HTML内容...');

    const result = await Promise.all(normalTabs.map(async tab => {
        let doc: Document | undefined = undefined;
        if (tab.id) {
            doc = await getTabHTMLDocWithTimeout(tab.id, TAB_HTML_TIMEOUT);
        }

        if (doc) {
            log(`[AI分组] 标签页 ${tab.id} (${tab.title}) Doc获取成功`);
        } else if (tab.id) {
            log(`[AI分组] 标签页 ${tab.id} (${tab.title}) 获取Doc超时或失败`);
        }
        return {
            id: tab.id,
            title: tab.title,
            url: tab.url,
            groupId: tab.groupId,
            windowId: tab.windowId,
            doc: doc
        };
    }));
    log('[AI分组] 所有标签页HTML内容获取完成');
    return result;
}

// 包装getTabHTML为带有超时机制的函数
async function getTabHTMLDocWithTimeout(tabId: number, timeout: number): Promise<Document | undefined> {
    const result = await Promise.race([
        getTabHtmlDoc(tabId),
        new Promise<Document | null>(resolve => setTimeout(() => resolve(null), timeout))
    ]);
    return result ?? undefined;
}

// 获取未分组的标签页
function getUngroupedTabs(tabs: TabInfo[]) {
    return tabs.filter((tab: TabInfo) => tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE);
}

// 获取已存在的分组信息
async function getExistingGroups() {
    const groups = await chrome.tabGroups.query({});
    return (await Promise.all(groups.map(async group => ({
        id: group.id,
        title: group.title,
        color: group.color,
        tabDetails: await getTabsInGroup(group.id)
    })))) as GroupInfo[]
}

async function getTabHtmlDoc(tabId: number): Promise<Document | null> {
    try {
        // 检查标签页是否可访问（不能访问 chrome:// 等特殊页面）
        const tab = await chrome.tabs.get(tabId);

        // 如果 URL 是 chrome:// 或 chrome-extension:// 等特殊协议，无法获取 HTML
        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
            log(`[AI分组] 标签页 ${tabId} 的 URL 不允许访问: ${tab.url}`);
            return null;
        }

        // 执行脚本获取 HTML 内容
        // 注意：不能直接返回 Document 对象，因为无法序列化
        // 所以我们在 content script 中克隆 document 并转换为 HTML 字符串
        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: () => {
                // 这个函数会在目标标签页的上下文中执行
                // 克隆整个 document 并返回其 HTML 字符串
                const clonedDoc = document.cloneNode(true) as Document;
                return clonedDoc.documentElement.outerHTML;
            }
        });

        if (!results || !results[0] || !results[0].result) {
            log(`[AI分组] 标签页 ${tabId} 获取 HTML 内容失败：结果为空`);
            return null;
        }

        const htmlString = results[0].result as string;
        if (!htmlString) {
            log(`[AI分组] 标签页 ${tabId} 获取的 HTML 内容为空`);
            return null;
        }

        // 使用 linkedom 将 HTML 字符串解析为 Document 对象
        // linkedom 是轻量级的 DOM 实现，专门为浏览器环境设计，可以在 service worker 中使用
        try {
            const { document: doc } = parseHTML(htmlString);
            log(`[AI分组] 标签页 ${tabId} 使用 linkedom 成功解析 Document 对象`);
            return doc as Document;
        } catch (error) {
            log(`[AI分组] 标签页 ${tabId} 使用 linkedom 解析失败: ${error}`);
            return null;
        }
    } catch (error) {
        log(`[AI分组] 获取标签页 ${tabId} 的 Doc 失败: ${error}`);
        return null;
    }
}


// 获取分组中的标签页
async function getTabsInGroup(groupId: number) {
    const tabs = await chrome.tabs.query({ groupId });
    return tabs.map(tab => ({
        id: tab.id,
        title: tab.title
    }));
}

async function groupTabs(waitForSummary: boolean = false) {
    log('[AI分组] ========== 开始分组流程 ==========');
    try {
        // 首先检查是否有可用的供应商类型
        const providerTypes = await getAllProviderTypes();
        if (Object.keys(providerTypes).length === 0) {
            log('[AI分组] ❌ 没有配置任何AI供应商类型，请先在设置页面添加供应商类型');
            throw new Error('没有配置任何AI供应商类型，请先在设置页面添加供应商类型');
        }
        const defaultProvider = await getDefaultProvider();
        if (!defaultProvider) {
            log('[AI分组] ❌ 没有配置默认AI供应商');
            throw new Error('没有配置默认AI供应商');
        }
        // 获取所有标签页
        log('[AI分组] 步骤1: 获取所有标签页...');
        const allTabs = await getAllTabs();
        log('[AI分组] 所有标签页数量:' + allTabs.length);

        // 获取未分组的标签页
        log('[AI分组] 步骤2: 筛选未分组的标签页...');
        const ungroupedTabs = getUngroupedTabs(allTabs);
        log('[AI分组] 未分组标签页数量:' + ungroupedTabs.length);

        // 如果没有未分组的标签，直接返回
        if (ungroupedTabs.length === 0) {
            log('[AI分组] ⚠️ 没有未分组的标签页，退出');
            return;
        }
        log('[AI分组] 未分组标签页标题:' + ungroupedTabs.map(t => t.title));

        // 检查总结状态
        const status = checkTabSummaryStatus(ungroupedTabs);
        log(`[AI分组] 总结状态: 已完成 ${status.completed.length}, 处理中 ${status.processing.length}, 待处理 ${status.pending.length}, 无总结 ${status.noSummary.length}`);

        // 如果需要等待总结完成，且有正在处理或待处理的标签页
        if (waitForSummary && (status.processing.length > 0 || status.pending.length > 0)) {
            log('[AI分组] 等待总结完成...');
            // 等待所有总结完成（最多等待 60 秒）
            const maxWaitTime = 60000;
            const startTime = Date.now();
            while ((status.processing.length > 0 || status.pending.length > 0) && (Date.now() - startTime) < maxWaitTime) {
                await new Promise(resolve => setTimeout(resolve, 1000)); // 等待 1 秒
                const newStatus = checkTabSummaryStatus(ungroupedTabs);
                status.processing = newStatus.processing;
                status.pending = newStatus.pending;
                log(`[AI分组] 等待中... 处理中: ${status.processing.length}, 待处理: ${status.pending.length}`);
            }
            if (status.processing.length > 0 || status.pending.length > 0) {
                log('[AI分组] ⚠️ 等待超时，部分标签页总结未完成');
            }
        }

        // 获取已存在的分组
        log('[AI分组] 步骤3: 获取已存在的分组...');
        const existingGroups = await getExistingGroups();
        log('[AI分组] 已存在分组数量:' + existingGroups.length);

        // 获取AI服务
        log('[AI分组] 步骤4: 初始化AI服务...');

        const aiConfig: AiConfig = {
            key: defaultProvider.key,
            model: defaultProvider.model,
            baseUrl: defaultProvider.baseUrl,
        };

        log('[AI分组] 使用供应商: ' + defaultProvider.name + ', 模型: ' + defaultProvider.model);
        const aiService = new AiTabService(ungroupedTabs, existingGroups, aiConfig);
        await aiService.group()
        log('[AI分组] AI服务初始化成功');
    } catch (err) {
        console.log(err);
        throw err;
    }
}

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    log('[AI分组] 收到消息: ' + request.action);

    if (request.action === 'groupTabs') {
        log('[AI分组] 从popup触发分组...');
        const waitForSummary = request.waitForSummary || false;
        groupTabs(waitForSummary).then(res => {
            log('[AI分组] popup触发分组成功');
            sendResponse({ success: true });
        }).catch(err => {
            log('[AI分组] popup触发分组失败');
            sendResponse({ success: false, error: err.message });
        })
        return true;
    }

    if (request.action === 'getSummaryProgress') {
        const progress = getSummaryProgress();
        sendResponse({ success: true, progress });
        return true;
    }

    if (request.action === 'checkSummaryStatus') {
        // 快速获取未分组标签页（不需要获取 HTML 内容）
        (async () => {
            try {
                // 只获取标签页基本信息，不获取 HTML 内容，提高响应速度
                const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
                const windowIds = windows.map(w => w.id).filter((id): id is number => id !== undefined);
                const tabs = await chrome.tabs.query({});
                const normalTabs = tabs.filter(tab => windowIds.includes(tab.windowId));
                const ungroupedTabs = normalTabs.filter(tab => tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE);

                // 转换为 TabInfo 格式（只需要 URL）
                const tabInfos: TabInfo[] = ungroupedTabs.map(tab => ({
                    id: tab.id,
                    title: tab.title,
                    url: tab.url,
                    groupId: tab.groupId,
                    windowId: tab.windowId
                }));

                const status = checkTabSummaryStatus(tabInfos);
                sendResponse({
                    success: true,
                    status: {
                        completed: status.completed.length,
                        processing: status.processing.length,
                        pending: status.pending.length,
                        noSummary: status.noSummary.length,
                        total: ungroupedTabs.length
                    }
                });
            } catch (err: any) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    return true;
});

// 监听右键菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    log('[AI分组] ========== 右键菜单被点击 ==========');
    log('[AI分组] 菜单项ID:' + info.menuItemId);
    log('[AI分组] 当前标签页:' + tab?.title + tab?.url);
    log('[AI分组] 点击信息:' + info);

    if (info.menuItemId === 'ai-group-tabs' || info.menuItemId === 'ai-group-tabs-action') {
        log('[AI分组] ✅ 匹配到AI分组菜单项，开始执行分组...');
        try {
            await groupTabs();
            log('[AI分组] ✅ 右键菜单触发的分组完成');
        } catch (error) {
            console.error('[AI分组] ❌ 右键菜单触发的分组失败:', error);
        }
    } else {
        log('[AI分组] ⚠️ 未匹配的菜单项，忽略');
    }
});

// 创建右键菜单
// 注意：Chrome API 不支持在标签页上直接右键显示菜单（contexts: ['tab'] 不存在）
// 我们使用 contexts: ['page'] 在页面内容区域右键时显示菜单
// 或者使用 contexts: ['action'] 在插件图标上右键时显示菜单
chrome.runtime.onInstalled.addListener(() => {
    log('[AI分组] 插件安装/更新，创建右键菜单...');
    // 在页面内容区域右键时显示
    chrome.contextMenus.create({
        id: 'ai-group-tabs',
        title: 'AI分组',
        contexts: ['page']
    }, () => {
        if (chrome.runtime.lastError) {
            console.error('[AI分组] ❌ 创建页面右键菜单失败:', chrome.runtime.lastError.message);
        } else {
            log('[AI分组] ✅ 页面右键菜单创建成功');
        }
    });

    // 在插件图标上右键时也显示（可选）
    chrome.contextMenus.create({
        id: 'ai-group-tabs-action',
        title: 'AI分组',
        contexts: ['action']
    }, () => {
        if (chrome.runtime.lastError) {
            console.error('[AI分组] ❌ 创建插件图标右键菜单失败:', chrome.runtime.lastError.message);
        } else {
            log('[AI分组] ✅ 插件图标右键菜单创建成功');
        }
    });
});

// 防抖定时器映射：tabId -> timeoutId
const debounceTimers: Map<number, NodeJS.Timeout> = new Map();

// 标签页URL映射：tabId -> url，用于在标签页关闭时获取URL信息
const tabUrlMap: Map<number, string> = new Map();

// 总结进度状态类型
type SummaryStatus = 'pending' | 'processing' | 'completed' | 'failed';

// 总结进度跟踪：url -> 状态
const summaryProgress: Map<string, { status: SummaryStatus; progress?: number; tabId?: number }> = new Map();

/**
 * 总结任务队列管理器
 * 限制同时进行的总结请求数量，避免触发 API 限流
 */
class SummaryQueue {
    private queue: Array<{ task: () => Promise<void>; url: string; tabId: number }> = [];
    private running: number = 0;
    private maxConcurrent: number = 3;

    /**
     * 添加总结任务到队列
     */
    async add(task: () => Promise<void>, url: string, tabId: number): Promise<void> {
        return new Promise((resolve, reject) => {
            this.queue.push({
                task: async () => {
                    try {
                        await task();
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                },
                url,
                tabId
            });
            this.processQueue();
        });
    }

    /**
     * 处理队列中的任务
     */
    private async processQueue(): Promise<void> {
        // 如果已达到最大并发数或队列为空，直接返回
        if (this.running >= this.maxConcurrent || this.queue.length === 0) {
            return;
        }

        // 从队列中取出一个任务
        const item = this.queue.shift();
        if (!item) {
            return;
        }

        this.running++;

        // 更新状态为 processing
        summaryProgress.set(item.url, {
            status: 'processing',
            tabId: item.tabId
        });

        try {
            await item.task();
            // 任务完成后，更新状态为 completed
            summaryProgress.set(item.url, {
                status: 'completed',
                tabId: item.tabId
            });
            // 发送进度更新消息
            notifyProgressUpdate();
        } catch (error) {
            // 任务失败，更新状态为 failed
            summaryProgress.set(item.url, {
                status: 'failed',
                tabId: item.tabId
            });
            log(`[总结队列] 任务失败: ${item.url}, ${error}`);
            // 发送进度更新消息
            notifyProgressUpdate();
        } finally {
            this.running--;
            // 继续处理队列中的下一个任务
            this.processQueue();
        }
    }

    /**
     * 获取队列状态
     */
    getStatus(): { queueLength: number; running: number } {
        return {
            queueLength: this.queue.length,
            running: this.running
        };
    }
}

// 创建全局总结队列实例
const summaryQueue = new SummaryQueue();

/**
 * 保存网页总结结果到 LocalStorage
 */
async function savePageSummary(tabId: number, url: string, summary: PageSummaryResult) {
    try {
        const result = await chrome.storage.local.get(SUMMARY_STORAGE_KEY);
        const summaries: Record<string, { tabId: number; url: string; summary: PageSummaryResult; timestamp: number }> =
            (result[SUMMARY_STORAGE_KEY] as Record<string, { tabId: number; url: string; summary: PageSummaryResult; timestamp: number }>) || {};
        summaries[url] = {
            tabId,
            url,
            summary,
            // 时间戳：记录总结结果的生成时间，可用于判断总结是否过期、清理旧数据等
            timestamp: Date.now()
        };
        await chrome.storage.local.set({ [SUMMARY_STORAGE_KEY]: summaries });
        log(`[网页总结] 已保存标签页 ${tabId} 的总结结果到 LocalStorage`);
    } catch (error) {
        log(`[网页总结] 保存总结结果失败: ${error}`);
    }
}


/**
 * 检查指定URL是否还被其他标签页使用
 */
async function isUrlStillInUse(url: string): Promise<boolean> {
    try {
        // 获取所有标签页
        const tabs = await chrome.tabs.query({});
        
        // 检查是否有其他标签页使用相同的URL
        const tabsWithSameUrl = tabs.filter(tab => 
            tab.url === url && 
            !tab.url.startsWith('chrome://') && 
            !tab.url.startsWith('chrome-extension://')
        );
        
        const isInUse = tabsWithSameUrl.length > 0;
        log(`[缓存管理] URL ${url} 仍被 ${tabsWithSameUrl.length} 个标签页使用`);
        return isInUse;
    } catch (error) {
        log(`[缓存管理] 检查URL使用状态失败: ${error}`);
        // 出错时保守处理，不删除缓存
        return true;
    }
}

/**
 * 从缓存中移除指定URL的总结结果
 */
async function removeSummaryFromCache(url: string): Promise<void> {
    try {
        // 获取当前的总结缓存
        const result = await chrome.storage.local.get(SUMMARY_STORAGE_KEY);
        const summaries: Record<string, any> = (result[SUMMARY_STORAGE_KEY] as Record<string, any>) || {};
        
        // 检查是否存在该URL的总结
        if (summaries[url]) {
            // 从缓存中删除
            delete summaries[url];
            
            // 保存更新后的缓存
            await chrome.storage.local.set({ [SUMMARY_STORAGE_KEY]: summaries });
            
            // 清理进度跟踪中的相关记录
            summaryProgress.delete(url);
            
            log(`[缓存管理] 已从缓存中移除URL ${url} 的总结结果`);
        } else {
            log(`[缓存管理] URL ${url} 在缓存中不存在，无需移除`);
        }
    } catch (error) {
        log(`[缓存管理] 移除缓存失败: ${error}`);
    }
}

/**
 * 检查是否已有该 URL 的总结结果
 */
async function hasSummary(url: string): Promise<boolean> {
    try {
        const result = await chrome.storage.local.get(SUMMARY_STORAGE_KEY);
        const summaries: Record<string, any> = (result[SUMMARY_STORAGE_KEY] as Record<string, any>) || {};
        return !!summaries[url];
    } catch (error) {
        log(`[网页总结] 检查总结结果失败: ${error}`);
        return false;
    }
}

/**
 * 获取总结进度信息
 */
function getSummaryProgress(): { total: number; completed: number; processing: number; pending: number; failed: number; progress: number } {
    let total = 0;
    let completed = 0;
    let processing = 0;
    let pending = 0;
    let failed = 0;

    summaryProgress.forEach((status) => {
        total++;
        if (status.status === 'completed') completed++;
        else if (status.status === 'processing') processing++;
        else if (status.status === 'pending') pending++;
        else if (status.status === 'failed') failed++;
    });

    const progress = total > 0 ? Math.round((completed / total) * 100) : 100;

    return { total, completed, processing, pending, failed, progress };
}

/**
 * 通知进度更新（发送消息给所有监听者）
 */
function notifyProgressUpdate() {
    const progress = getSummaryProgress();
    // 尝试发送消息给 popup（如果打开的话）
    // 注意：Chrome extension 无法直接发送消息给 popup，需要 popup 主动监听
    // 这里我们只是记录日志，实际更新由 popup 轮询实现
    log(`[进度更新] 已完成: ${progress.completed}/${progress.total}, 处理中: ${progress.processing}, 待处理: ${progress.pending}`);
}

/**
 * 检查标签页的总结状态
 */
function checkTabSummaryStatus(tabs: TabInfo[]): {
    completed: TabInfo[];
    processing: TabInfo[];
    pending: TabInfo[];
    noSummary: TabInfo[]
} {
    const completed: TabInfo[] = [];
    const processing: TabInfo[] = [];
    const pending: TabInfo[] = [];
    const noSummary: TabInfo[] = [];

    tabs.forEach(tab => {
        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
            return;
        }

        const status = summaryProgress.get(tab.url);
        if (status) {
            if (status.status === 'completed') {
                completed.push(tab);
            } else if (status.status === 'processing') {
                processing.push(tab);
            } else if (status.status === 'pending') {
                pending.push(tab);
            } else {
                noSummary.push(tab);
            }
        } else {
            // 检查 LocalStorage 中是否有总结结果
            // 这里先假设没有，实际会在 group() 方法中检查
            noSummary.push(tab);
        }
    });

    return { completed, processing, pending, noSummary };
}

/**
 * 对标签页进行网页总结（带防抖）
 */
async function summarizeTabWithDebounce(tabId: number, url: string, forceRefresh: boolean = false) {
    // 清除之前的定时器
    const existingTimer = debounceTimers.get(tabId);
    if (existingTimer) {
        clearTimeout(existingTimer);
    }

    // 检查是否已有总结结果
    const hasExistingSummary = await hasSummary(url);
    if (hasExistingSummary) {
        log(`[网页总结] 标签页 ${tabId} 的 URL ${url} 已有总结结果，跳过`);
        summaryProgress.set(url, { status: 'completed', tabId });
        return;
    }

    // 检查是否已经在处理中
    const existingStatus = summaryProgress.get(url);
    if (existingStatus?.status === 'processing') {
        log(`[网页总结] 标签页 ${tabId} 的 URL ${url} 正在处理中，跳过`);
        return;
    }

    // 设置新的防抖定时器
    const timer = setTimeout(async () => {
        debounceTimers.delete(tabId);

        // 再次检查是否已有总结结果（可能在防抖期间已完成）
        const hasSummaryNow = await hasSummary(url);
        if (hasSummaryNow) {
            log(`[网页总结] 标签页 ${tabId} 的 URL ${url} 在防抖期间已完成总结，跳过`);
            summaryProgress.set(url, { status: 'completed', tabId });
            return;
        }

        // 标记为 pending
        summaryProgress.set(url, { status: 'pending', tabId });

        // 将任务添加到队列
        await summaryQueue.add(async () => {
            try {
                // 获取默认 AI 配置
                const defaultProvider = await getDefaultProvider();
                if (!defaultProvider) {
                    log(`[网页总结] 没有配置默认AI供应商，跳过总结`);
                    summaryProgress.set(url, { status: 'failed', tabId });
                    return;
                }

                const aiConfig: AiConfig = {
                    key: defaultProvider.key,
                    model: defaultProvider.model,
                    baseUrl: defaultProvider.baseUrl,
                };

                // 获取标签页 HTML 内容
                const doc = await getTabHTMLDocWithTimeout(tabId, TAB_HTML_TIMEOUT);
                if (!doc) {
                    log(`[网页总结] 标签页 ${tabId} 获取 HTML 内容失败，跳过总结`);
                    summaryProgress.set(url, { status: 'failed', tabId });
                    return;
                }

                // 创建 AiTabService 实例用于调用总结方法
                const aiService = new AiTabService([], [], aiConfig);

                // 进行网页总结
                log(`[网页总结] 开始总结标签页 ${tabId}: ${url}`);
                const summary = await aiService.summarizePage(tabId, doc);

                if (summary) {
                    // 保存到 LocalStorage
                    await savePageSummary(tabId, url, summary);
                    log(`[网页总结] 标签页 ${tabId} 总结完成`);
                } else {
                    log(`[网页总结] 标签页 ${tabId} 总结结果为空`);
                    summaryProgress.set(url, { status: 'failed', tabId });
                }
            } catch (error) {
                log(`[网页总结] 标签页 ${tabId} 总结过程出错: ${error}`);
                summaryProgress.set(url, { status: 'failed', tabId });
                throw error;
            }
        }, url, tabId);

        log(`[网页总结] 标签页 ${tabId} 的任务已加入队列`);
    }, SUMMARY_DEBOUNCE_DELAY);

    debounceTimers.set(tabId, timer);
    log(`[网页总结] 为标签页 ${tabId} 设置防抖定时器，${SUMMARY_DEBOUNCE_DELAY}ms 后执行`);
}

// 监听标签页创建事件
chrome.tabs.onCreated.addListener(async function (tab) {
    log('新标签页已创建:' + tab.id);

    // 记录标签页URL映射
    if (tab.id && tab.url) {
        tabUrlMap.set(tab.id, tab.url);
        log(`[缓存管理] 记录标签页 ${tab.id} 的URL: ${tab.url}`);
    }

    // 如果标签页有 URL，进行总结
    if (tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
        // 等待一下，确保页面加载
        setTimeout(() => {
            if (tab.id && tab.url) {
                summarizeTabWithDebounce(tab.id, tab.url);
            }
        }, 1000);
    }
});

// 监听标签页关闭事件
chrome.tabs.onRemoved.addListener(async function (tabId, removeInfo) {
    log('标签页已关闭，ID:' + tabId);

    // 清除该标签页的防抖定时器
    const timer = debounceTimers.get(tabId);
    if (timer) {
        clearTimeout(timer);
        debounceTimers.delete(tabId);
        log(`[网页总结] 已清除标签页 ${tabId} 的防抖定时器`);
    }

    // 获取关闭标签页的URL
    const closedTabUrl = tabUrlMap.get(tabId);
    if (closedTabUrl) {
        // 从映射中移除
        tabUrlMap.delete(tabId);
        
        // 只处理普通的HTTP/HTTPS页面
        if (!closedTabUrl.startsWith('chrome://') && !closedTabUrl.startsWith('chrome-extension://')) {
            // 检查该URL是否还被其他标签页使用
            const isStillInUse = await isUrlStillInUse(closedTabUrl);
            if (!isStillInUse) {
                // 如果没有其他标签页使用该URL，则清理缓存
                await removeSummaryFromCache(closedTabUrl);
                log(`[缓存管理] 标签页 ${tabId} 关闭，URL ${closedTabUrl} 已无人使用，已清理缓存`);
            } else {
                log(`[缓存管理] 标签页 ${tabId} 关闭，但URL ${closedTabUrl} 仍被其他标签页使用，保留缓存`);
            }
        }
    } else {
        log(`[缓存管理] 无法获取标签页 ${tabId} 的URL信息，跳过缓存清理`);
    }
});

// 监听标签页更新事件
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (changeInfo.url && tab.url) {
        log('标签页URL已更新:' + changeInfo.url);
        
        // 更新URL映射
        tabUrlMap.set(tabId, tab.url);

        // 只处理普通 HTTP/HTTPS 页面
        if (!tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
            // 使用防抖机制，避免重定向时频繁调用
            summarizeTabWithDebounce(tabId, tab.url);
        }
    }
    
    // 监听页面刷新（页面加载完成时触发）
    if (changeInfo.status === 'complete' && tab.url) {
        log('标签页页面加载完成（刷新）:' + tab.url);
        
        // 更新URL映射
        tabUrlMap.set(tabId, tab.url);
        
        // 只处理普通 HTTP/HTTPS 页面
        if (!tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
            // 强制重新总结（跳过缓存检查）
            summarizeTabWithForceRefresh(tabId, tab.url);
        }
    }
});