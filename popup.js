// 立即分组
document.getElementById('groupBtn').addEventListener('click', async () => {
  const statusEl = document.getElementById('status');
  statusEl.textContent = '正在分组...';
  
  try {
    // 发送消息给background script执行分组
    const response = await chrome.runtime.sendMessage({ action: 'groupTabs' });
    if (response && response.success) {
      statusEl.textContent = '分组完成！';
    } else {
      statusEl.textContent = '分组失败: ' + (response?.error || '未知错误');
    }
  } catch (error) {
    statusEl.textContent = '分组失败: ' + error.message;
  }
});

// 打开设置
document.getElementById('settingsBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

