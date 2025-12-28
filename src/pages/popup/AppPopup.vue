<template>
    <div class="container">
        <h1>AI标签分组</h1>
        <p class="description">智能分组您的浏览器标签页</p>

        <button id="groupBtn" class="btn" @click="groupTabs">立即分组</button>
        <button id="settingsBtn" class="btn btn-secondary" @click="toSettings">打开设置</button>

        <div id="status" class="status" v-text="statusEl"></div>
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const statusEl = ref("")
function toSettings() {
    chrome.runtime.openOptionsPage();
}
async function groupTabs() {
    statusEl.value = '正在分组...';
    try {
        // 发送消息给background script执行分组
        const response = await chrome.runtime.sendMessage({ action: 'groupTabs' });
        if (response && response.success) {
            statusEl.value = '分组完成！';
        } else {
            statusEl.value = '分组失败: ' + (response?.error || '未知错误');
        }
    } catch (error: any) {
        statusEl.value = '分组失败: ' + error.message;
    }
}
</script>

<style scoped></style>