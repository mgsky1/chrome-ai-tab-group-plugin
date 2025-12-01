// DeepSeek AI服务实现（内联到background.js，因为Service Worker不支持动态import）
class DeepSeekService {
  constructor() {
    this.apiKey = null;
    this.apiUrl = 'https://api.deepseek.com/v1/chat/completions';
  }

  async init() {
    console.log('[DeepSeek] 初始化，读取API Key...');
    const config = await chrome.storage.sync.get(['deepseekApiKey']);
    this.apiKey = config.deepseekApiKey;
    if (!this.apiKey) {
      console.error('[DeepSeek] ❌ API Key未配置');
      throw new Error('请先在设置中配置DeepSeek API Key');
    }
    console.log('[DeepSeek] ✅ API Key已读取（长度:', this.apiKey.length, '）');
  }

  async groupTabs(tabTitles, existingGroups) {
    console.log('[DeepSeek] ========== 开始调用DeepSeek API ==========');
    console.log('[DeepSeek] 待分组标签数量:', tabTitles.length);
    console.log('[DeepSeek] 已有分组数量:', existingGroups.length);
    
    await this.init();
    
    // 构建prompt
    console.log('[DeepSeek] 构建Prompt...');
    const prompt = this.buildPrompt(tabTitles, existingGroups);
    console.log('[DeepSeek] Prompt长度:', prompt.length, '字符');
    console.log('[DeepSeek] Prompt内容预览:', prompt.substring(0, 200) + '...');
    
    // 调用API
    console.log('[DeepSeek] 准备发送API请求到:', this.apiUrl);
    const requestBody = {
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: '你是一个专业的网页标签分类助手。你需要根据网页标题对标签页进行智能分组。'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3
    };
    console.log('[DeepSeek] 请求体:', JSON.stringify(requestBody, null, 2));
    
    const startTime = Date.now();
    console.log('[DeepSeek] 发送API请求，API Key长度:', this.apiKey.length);
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });
    
    const requestTime = Date.now() - startTime;
    console.log('[DeepSeek] API请求完成，耗时:', requestTime, 'ms');
    console.log('[DeepSeek] 响应状态:', response.status, response.statusText);

    if (!response.ok) {
      const error = await response.text();
      console.error('[DeepSeek] ❌ API请求失败');
      console.error('[DeepSeek] 错误响应:', error);
      throw new Error(`DeepSeek API错误: ${error}`);
    }

    const data = await response.json();
    console.log('[DeepSeek] API响应数据:', JSON.stringify(data, null, 2));
    const content = data.choices[0].message.content;
    console.log('[DeepSeek] AI返回的原始内容:', content);
    
    // 解析AI返回的JSON
    console.log('[DeepSeek] 开始解析AI响应...');
    const result = this.parseResponse(content);
    console.log('[DeepSeek] ✅ 解析完成，分组结果:', JSON.stringify(result, null, 2));
    return result;
  }

  buildPrompt(tabTitles, existingGroups) {
    let prompt = `请根据以下网页标题对标签页进行智能分组。相同类型或主题的网页应该归为一组。

待分组的标签页标题列表（索引从0开始）：
${tabTitles.map((title, index) => `${index}: ${title}`).join('\n')}

`;

    if (existingGroups.length > 0) {
      prompt += `已存在的分组（如果新标签页属于某个已有分组，请将其归入该分组）：
${existingGroups.map((group, idx) => {
  return `分组"${group.title}"包含的标签：\n${group.tabTitles.map(t => `  - ${t}`).join('\n')}`;
}).join('\n\n')}

`;
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

请开始分析并返回JSON结果：`;

    return prompt;
  }

  parseResponse(content) {
    console.log('[DeepSeek] 开始解析响应，原始内容长度:', content.length);
    // 尝试提取JSON（AI可能返回markdown格式的代码块）
    let jsonStr = content.trim();
    
    // 移除可能的markdown代码块标记
    if (jsonStr.startsWith('```')) {
      console.log('[DeepSeek] 检测到markdown代码块，正在提取...');
      const lines = jsonStr.split('\n');
      const startIdx = lines.findIndex(line => line.trim().startsWith('```'));
      const endIdx = lines.findIndex((line, idx) => idx > startIdx && line.trim().startsWith('```'));
      if (startIdx >= 0 && endIdx > startIdx) {
        jsonStr = lines.slice(startIdx + 1, endIdx).join('\n');
        console.log('[DeepSeek] 已提取代码块内容');
      }
    }
    
    // 尝试提取JSON对象
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
      console.log('[DeepSeek] 已提取JSON对象');
    }
    
    console.log('[DeepSeek] 准备解析的JSON字符串:', jsonStr.substring(0, 500));
    
    try {
      const result = JSON.parse(jsonStr);
      console.log('[DeepSeek] JSON解析成功');
      
      // 验证结果格式
      if (!result.newGroups && !result.existingGroups) {
        console.error('[DeepSeek] ❌ 返回格式不正确，缺少newGroups或existingGroups');
        throw new Error('返回格式不正确');
      }
      
      const parsedResult = {
        newGroups: result.newGroups || {},
        existingGroups: result.existingGroups || {}
      };
      
      console.log('[DeepSeek] ✅ 解析完成，新分组数:', Object.keys(parsedResult.newGroups).length);
      console.log('[DeepSeek] ✅ 已有分组更新数:', Object.keys(parsedResult.existingGroups).length);
      
      return parsedResult;
    } catch (error) {
      console.error('[DeepSeek] ❌ 解析AI响应失败:', error);
      console.error('[DeepSeek] 错误详情:', error.message);
      console.error('[DeepSeek] 原始内容:', content);
      throw new Error(`解析AI响应失败: ${error.message}`);
    }
  }
}

// 获取AI服务（不再使用动态import）
async function getAIService() {
  console.log('[AI分组] 获取AI服务...');
  const config = await chrome.storage.sync.get(['aiProvider']);
  const provider = config.aiProvider || 'deepseek';
  console.log('[AI分组] 选择的AI供应商:', provider);
  
  if (provider === 'deepseek') {
    console.log('[AI分组] 创建DeepSeek服务实例...');
    const service = new DeepSeekService();
    console.log('[AI分组] DeepSeek服务创建成功');
    return service;
  }
  
  throw new Error(`不支持的AI供应商: ${provider}`);
}

// 创建右键菜单
// 注意：Chrome API 不支持在标签页上直接右键显示菜单（contexts: ['tab'] 不存在）
// 我们使用 contexts: ['page'] 在页面内容区域右键时显示菜单
// 或者使用 contexts: ['action'] 在插件图标上右键时显示菜单
chrome.runtime.onInstalled.addListener(() => {
  console.log('[AI分组] 插件安装/更新，创建右键菜单...');
  // 在页面内容区域右键时显示
  chrome.contextMenus.create({
    id: 'ai-group-tabs',
    title: 'AI分组',
    contexts: ['page']
  }, () => {
    if (chrome.runtime.lastError) {
      console.error('[AI分组] ❌ 创建页面右键菜单失败:', chrome.runtime.lastError.message);
    } else {
      console.log('[AI分组] ✅ 页面右键菜单创建成功');
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
      console.log('[AI分组] ✅ 插件图标右键菜单创建成功');
    }
  });
});

// 监听右键菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  console.log('[AI分组] ========== 右键菜单被点击 ==========');
  console.log('[AI分组] 菜单项ID:', info.menuItemId);
  console.log('[AI分组] 当前标签页:', tab?.title, tab?.url);
  console.log('[AI分组] 点击信息:', info);
  
  if (info.menuItemId === 'ai-group-tabs' || info.menuItemId === 'ai-group-tabs-action') {
    console.log('[AI分组] ✅ 匹配到AI分组菜单项，开始执行分组...');
    try {
      await groupTabs();
      console.log('[AI分组] ✅ 右键菜单触发的分组完成');
    } catch (error) {
      console.error('[AI分组] ❌ 右键菜单触发的分组失败:', error);
    }
  } else {
    console.log('[AI分组] ⚠️ 未匹配的菜单项，忽略');
  }
});

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[AI分组] 收到消息', request);
  if (request.action === 'groupTabs') {
    console.log('[AI分组] 从popup触发分组...');
    groupTabs().then(() => {
      console.log('[AI分组] popup触发分组成功');
      sendResponse({ success: true });
    }).catch((error) => {
      console.error('[AI分组] popup触发分组失败', error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // 保持消息通道开放以支持异步响应
  }
});

// 获取所有标签页信息（只获取普通窗口中的标签页）
async function getAllTabs() {
  // 先获取所有普通窗口
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  const windowIds = windows.map(w => w.id);
  console.log('[AI分组] 普通窗口数量:', windowIds.length, '窗口ID:', windowIds);
  
  // 查询所有标签页
  const tabs = await chrome.tabs.query({});
  
  // 过滤出普通窗口中的标签页
  const normalTabs = tabs.filter(tab => {
    // 检查标签页是否在普通窗口中
    return windowIds.includes(tab.windowId);
  });
  
  console.log('[AI分组] 总标签页数:', tabs.length, '普通窗口标签页数:', normalTabs.length);
  
  if (tabs.length > normalTabs.length) {
    const filteredCount = tabs.length - normalTabs.length;
    console.log('[AI分组] ⚠️ 已过滤', filteredCount, '个特殊窗口中的标签页（弹出窗口、开发者工具等）');
  }
  
  return normalTabs.map(tab => ({
    id: tab.id,
    title: tab.title,
    url: tab.url,
    groupId: tab.groupId,
    windowId: tab.windowId
  }));
}

// 获取未分组的标签页
function getUngroupedTabs(tabs) {
  return tabs.filter(tab => tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE);
}

// 获取已存在的分组信息
async function getExistingGroups() {
  const groups = await chrome.tabGroups.query({});
  return groups.map(group => ({
    id: group.id,
    title: group.title,
    color: group.color,
    tabIds: []
  }));
}

// 获取分组中的标签页
async function getTabsInGroup(groupId) {
  const tabs = await chrome.tabs.query({ groupId });
  return tabs.map(tab => ({
    id: tab.id,
    title: tab.title
  }));
}

// 主分组函数
async function groupTabs() {
  console.log('[AI分组] ========== 开始分组流程 ==========');
  try {
    // 获取所有标签页
    console.log('[AI分组] 步骤1: 获取所有标签页...');
    const allTabs = await getAllTabs();
    console.log('[AI分组] 所有标签页数量:', allTabs.length);
    console.log('[AI分组] 标签页列表:', allTabs.map(t => ({ id: t.id, title: t.title, groupId: t.groupId })));
    
    // 获取未分组的标签页
    console.log('[AI分组] 步骤2: 筛选未分组的标签页...');
    const ungroupedTabs = getUngroupedTabs(allTabs);
    console.log('[AI分组] 未分组标签页数量:', ungroupedTabs.length);
    
    // 如果没有未分组的标签，直接返回
    if (ungroupedTabs.length === 0) {
      console.log('[AI分组] ⚠️ 没有未分组的标签页，退出');
      return;
    }
    
    console.log('[AI分组] 未分组标签页标题:', ungroupedTabs.map(t => t.title));
    
    // 获取已存在的分组
    console.log('[AI分组] 步骤3: 获取已存在的分组...');
    const existingGroups = await getExistingGroups();
    console.log('[AI分组] 已存在分组数量:', existingGroups.length);
    
    // 获取每个分组中的标签页标题（用于AI判断）
    for (let group of existingGroups) {
      const tabsInGroup = await getTabsInGroup(group.id);
      group.tabTitles = tabsInGroup.map(t => t.title);
      console.log(`[AI分组] 分组"${group.title}"包含标签:`, group.tabTitles);
    }
    
    // 获取AI服务
    console.log('[AI分组] 步骤4: 初始化AI服务...');
    const aiService = await getAIService();
    console.log('[AI分组] AI服务初始化成功');
    
    // 准备待分组的标签页标题
    const tabTitles = ungroupedTabs.map(tab => tab.title);
    console.log('[AI分组] 步骤5: 准备调用AI API进行分组...');
    console.log('[AI分组] 待分组标签标题:', tabTitles);
    
    // 调用AI进行分组
    console.log('[AI分组] 步骤6: 调用DeepSeek API...');
    const groupingResult = await aiService.groupTabs(tabTitles, existingGroups);
    console.log('[AI分组] AI返回的分组结果:', JSON.stringify(groupingResult, null, 2));
    
    // 执行分组操作
    console.log('[AI分组] 步骤7: 执行分组操作...');
    await executeGrouping(ungroupedTabs, existingGroups, groupingResult);
    
    console.log('[AI分组] ✅ 分组完成！');
  } catch (error) {
    console.error('[AI分组] ❌ 分组失败:', error);
    console.error('[AI分组] 错误堆栈:', error.stack);
    // 可以在这里添加错误提示
  }
}

// 验证标签页是否在普通窗口中
async function validateTabsInNormalWindow(tabIds) {
  // 获取所有普通窗口
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  const windowIds = windows.map(w => w.id);
  
  // 获取这些标签页的详细信息
  const tabs = await chrome.tabs.query({});
  const tabsInfo = tabs.filter(t => tabIds.includes(t.id));
  
  // 过滤出在普通窗口中的标签页
  const validTabIds = tabsInfo
    .filter(tab => windowIds.includes(tab.windowId))
    .map(tab => tab.id);
  
  if (validTabIds.length < tabIds.length) {
    const invalidCount = tabIds.length - validTabIds.length;
    console.log(`[AI分组] ⚠️ 过滤掉${invalidCount}个不在普通窗口中的标签页`);
  }
  
  return validTabIds;
}

// 执行分组操作
async function executeGrouping(ungroupedTabs, existingGroups, groupingResult) {
  console.log('[AI分组] 开始执行分组操作...');
  
  // 先处理添加到已有分组的情况
  const existingGroupsToUpdate = Object.entries(groupingResult.existingGroups || {});
  console.log('[AI分组] 需要添加到已有分组的数量:', existingGroupsToUpdate.length);
  
  for (const [groupName, tabIndices] of existingGroupsToUpdate) {
    console.log(`[AI分组] 处理已有分组"${groupName}"，标签索引:`, tabIndices);
    const existingGroup = existingGroups.find(g => g.title === groupName);
    if (existingGroup && tabIndices.length > 0) {
      const tabIds = tabIndices.map(idx => ungroupedTabs[idx].id);
      console.log(`[AI分组] 添加到分组"${groupName}"的标签ID:`, tabIds);
      
      // 验证标签页是否在普通窗口中
      const validTabIds = await validateTabsInNormalWindow(tabIds);
      if (validTabIds.length === 0) {
        console.log(`[AI分组] ⚠️ 分组"${groupName}"的所有标签都不在普通窗口中，跳过`);
        continue;
      }
      
      // 获取该分组中已有的标签ID
      const existingTabIds = (await chrome.tabs.query({ groupId: existingGroup.id })).map(t => t.id);
      console.log(`[AI分组] 分组"${groupName}"已有标签ID:`, existingTabIds);
      
      // 验证已有标签页是否在普通窗口中
      const validExistingTabIds = await validateTabsInNormalWindow(existingTabIds);
      
      // 将所有标签ID合并（包括已有和新添加的）
      const allTabIds = [...validExistingTabIds, ...validTabIds];
      // 重新分组，确保所有标签在同一组
      // 注意：Chrome API 会将所有标签合并到第一个标签所在的分组
      if (allTabIds.length > 0) {
        console.log(`[AI分组] 合并标签到分组"${groupName}"，总标签数:`, allTabIds.length);
        try {
          const groupId = await chrome.tabs.group({ tabIds: allTabIds });
          await chrome.tabGroups.update(groupId, {
            title: groupName,
            color: getRandomColor()
          });
          console.log(`[AI分组] ✅ 已添加到分组"${groupName}"`);
        } catch (error) {
          console.error(`[AI分组] ❌ 添加到分组"${groupName}"失败:`, error);
        }
      }
    } else {
      console.log(`[AI分组] ⚠️ 未找到分组"${groupName}"或标签索引为空`);
    }
  }
  
  // 创建新分组
  const newGroupsToCreate = Object.entries(groupingResult.newGroups || {});
  console.log('[AI分组] 需要创建的新分组数量:', newGroupsToCreate.length);
  
  for (const [groupName, tabIndices] of newGroupsToCreate) {
    console.log(`[AI分组] 创建新分组"${groupName}"，标签索引:`, tabIndices);
    if (tabIndices.length > 0) {
      const tabIds = tabIndices.map(idx => ungroupedTabs[idx].id);
      console.log(`[AI分组] 新分组"${groupName}"的标签ID:`, tabIds);
      
      // 过滤掉已经添加到已有分组的标签
      const tabsToGroup = tabIds.filter(tabId => {
        // 检查这个标签是否已经被添加到已有分组
        return !Object.values(groupingResult.existingGroups || {}).some(indices => 
          indices.some(idx => ungroupedTabs[idx].id === tabId)
        );
      });
      
      console.log(`[AI分组] 过滤后的标签ID（排除已分组）:`, tabsToGroup);
      
      // 验证标签页是否在普通窗口中
      const validTabsToGroup = await validateTabsInNormalWindow(tabsToGroup);
      if (validTabsToGroup.length === 0) {
        console.log(`[AI分组] ⚠️ 新分组"${groupName}"的所有标签都不在普通窗口中，跳过`);
        continue;
      }
      
      if (validTabsToGroup.length > 0) {
        console.log(`[AI分组] 创建新分组"${groupName}"，包含${validTabsToGroup.length}个标签`);
        try {
          const groupId = await chrome.tabs.group({ tabIds: validTabsToGroup });
          console.log(`[AI分组] 新分组ID:`, groupId);
          await chrome.tabGroups.update(groupId, {
            title: groupName,
            color: getRandomColor()
          });
          console.log(`[AI分组] ✅ 已创建新分组"${groupName}"`);
        } catch (error) {
          console.error(`[AI分组] ❌ 创建新分组"${groupName}"失败:`, error);
        }
      } else {
        console.log(`[AI分组] ⚠️ 新分组"${groupName}"的标签都已分组，跳过`);
      }
    }
  }
  
  console.log('[AI分组] 分组操作执行完成');
}

// 获取随机颜色
function getRandomColor() {
  const colors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'];
  return colors[Math.floor(Math.random() * colors.length)];
}

