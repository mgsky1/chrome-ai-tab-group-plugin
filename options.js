// 加载保存的设置
async function loadSettings() {
  const config = await chrome.storage.sync.get(['aiProvider', 'deepseekApiKey']);
  
  if (config.aiProvider) {
    document.getElementById('aiProvider').value = config.aiProvider;
  }
  
  if (config.deepseekApiKey) {
    document.getElementById('deepseekApiKey').value = config.deepseekApiKey;
  }
  
  // 根据选择的供应商显示/隐藏配置项
  updateProviderConfig();
}

// 更新供应商配置显示
function updateProviderConfig() {
  const provider = document.getElementById('aiProvider').value;
  const deepseekConfig = document.getElementById('deepseekConfig');
  
  deepseekConfig.style.display = provider === 'deepseek' ? 'block' : 'none';
}

// 保存设置
async function saveSettings(e) {
  e.preventDefault();
  
  const aiProvider = document.getElementById('aiProvider').value;
  const deepseekApiKey = document.getElementById('deepseekApiKey').value;
  
  try {
    await chrome.storage.sync.set({
      aiProvider: aiProvider,
      deepseekApiKey: deepseekApiKey
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
});

