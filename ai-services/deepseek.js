// DeepSeek AI服务实现
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

// 导出类
export { DeepSeekService };

