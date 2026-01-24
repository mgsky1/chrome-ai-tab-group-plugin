import AiTabService from './aiServive'
import { log } from './aiServive';
import type { TabInfo, GroupInfo, AiConfig } from './aiServive';
import { getDefaultProvider, getAllProviderTypes } from './configStorage';
import { parseHTML } from 'linkedom';
const TAB_HTML_TIMEOUT = 5000; // 5秒超时

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

async function groupTabs() {
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
            useExactMode: defaultProvider.useExactMode ?? false
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
    log('[AI分组] 收到消息');
    if (request.action === 'groupTabs') {
        log('[AI分组] 从popup触发分组...');
        groupTabs().then(res => {
            log('[AI分组] popup触发分组成功');
            sendResponse({ success: true });
        }).catch(err => {
            log('[AI分组] popup触发分组失败');
            sendResponse({ success: false, error: err.message });
        })
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