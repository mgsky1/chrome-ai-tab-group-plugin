// 监听来自popup的消息
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.action === 'groupTabs') {
        console.log("=======");
        return true; // 保持消息通道开放以支持异步响应
    }
  });