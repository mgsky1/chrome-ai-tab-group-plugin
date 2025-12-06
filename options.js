// 加载保存的设置
async function loadSettings() {
  const config = await chrome.storage.sync.get([
    'aiProvider', 
    'deepseekApiKey', 
    'openrouterApiKey', 
    'openrouterModel',
    'deepseekDefaultProvider',
    'openrouterDefaultProvider'
  ]);
  
  if (config.aiProvider) {
    document.getElementById('aiProvider').value = config.aiProvider;
    if (config.aiProvider == 'deepseek') {
      document.getElementById('deepseekDefaultProvider').checked = true;
    } else if (config.aiProvider == 'openrouter') {
      document.getElementById('openrouterDefaultProvider').checked = true;
    }
    
  }
  
  if (config.deepseekApiKey) {
    document.getElementById('deepseekApiKey').value = config.deepseekApiKey;
  }
  
  if (config.openrouterApiKey) {
    document.getElementById('openrouterApiKey').value = config.openrouterApiKey;
  }
  
  if (config.openrouterModel) {
    document.getElementById('openrouterModel').value = config.openrouterModel;
  }
  
  if (config.deepseekDefaultProvider) {
    document.getElementById('deepseekDefaultProvider').checked = config.deepseekDefaultProvider;
  }
  
  if (config.openrouterDefaultProvider) {
    document.getElementById('openrouterDefaultProvider').checked = config.openrouterDefaultProvider;
  }
  
  // 根据选择的供应商显示/隐藏配置项
  updateProviderConfig();
}

// 更新供应商配置显示
function updateProviderConfig() {
  const provider = document.getElementById('aiProvider').value;
  const deepseekConfig = document.getElementById('deepseekConfig');
  const openrouterConfig = document.getElementById('openrouterConfig');
  
  deepseekConfig.style.display = provider === 'deepseek' ? 'block' : 'none';
  openrouterConfig.style.display = provider === 'openrouter' ? 'block' : 'none';
}

// 处理默认供应商checkbox的互斥逻辑
function handleDefaultProviderChange(checkedProvider) {
  const deepseekCheckbox = document.getElementById('deepseekDefaultProvider');
  const openrouterCheckbox = document.getElementById('openrouterDefaultProvider');
  
  if (checkedProvider === 'deepseek' && deepseekCheckbox.checked) {
    openrouterCheckbox.checked = false;
  } else if (checkedProvider === 'openrouter' && openrouterCheckbox.checked) {
    deepseekCheckbox.checked = false;
  }
}

// 保存设置
async function saveSettings(e) {
  e.preventDefault();
  
  let aiProvider = null;
  const deepseekApiKey = document.getElementById('deepseekApiKey').value;
  const openrouterApiKey = document.getElementById('openrouterApiKey').value;
  const openrouterModel = document.getElementById('openrouterModel').value;
  const deepseekCheckbox = document.getElementById('deepseekDefaultProvider');
  const openrouterCheckbox = document.getElementById('openrouterDefaultProvider');
  if (deepseekCheckbox.checked) {
    aiProvider = 'deepseek';
  } else if (openrouterCheckbox.checked) {
    aiProvider = 'openrouter';
  } else {
    aiProvider = document.getElementById('aiProvider').value;
  }
  
  try {
    await chrome.storage.sync.set({
      aiProvider: aiProvider,
      deepseekApiKey: deepseekApiKey,
      openrouterApiKey: openrouterApiKey,
      openrouterModel: openrouterModel
    });
    
    showStatus('设置已保存！', 'success');
  } catch (error) {
    showStatus('保存失败: ' + error.message, 'error');
  }
}

// 显示状态消息
function showStatus(message, type) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  
  setTimeout(() => {
    statusEl.className = 'status';
  }, 3000);
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  
  document.getElementById('aiProvider').addEventListener('change', updateProviderConfig);
  document.getElementById('settingsForm').addEventListener('submit', saveSettings);
  
  // 处理默认供应商checkbox的互斥逻辑
  document.getElementById('deepseekDefaultProvider').addEventListener('change', function() {
    if (this.checked) {
      handleDefaultProviderChange('deepseek');
    }
  });
  
  document.getElementById('openrouterDefaultProvider').addEventListener('change', function() {
    if (this.checked) {
      handleDefaultProviderChange('openrouter');
    }
  });
});

