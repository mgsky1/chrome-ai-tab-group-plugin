<template>
    <div class="container">
        <h1>AI标签分组</h1>
        <p class="description">智能分组您的浏览器标签页</p>
        <!-- 正常分组按钮 -->
        <button id="groupBtn" class="btn" @click="groupTabs" :disabled="isGrouping">
            {{ isGrouping ? '分组中...' : '立即分组' }}
        </button>
        <button id="settingsBtn" class="btn btn-secondary" @click="toSettings">打开设置</button>

        <div id="status" class="status" v-text="statusEl"></div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

const statusEl = ref("")
const isGrouping = ref(false)

// 进度更新定时器
let progressUpdateTimer: number | null = null


function toSettings() {
    chrome.runtime.openOptionsPage();
}


async function groupTabs() {
    isGrouping.value = true
    statusEl.value = '正在分组...';
    try {
        // 发送消息给background script执行分组
        const response = await chrome.runtime.sendMessage({
            action: 'groupTabs',
        })
    
        if (response) {
            if (response && response.success) {
                statusEl.value = '分组完成！';
            } else {
                statusEl.value = '分组失败: ' + (response?.error || '未知错误');
            }
        }
    
    } catch (error: any) {
        statusEl.value = '分组失败: ' + error.message;
    } finally {
        isGrouping.value = false
    }

}
</script>

<style scoped>
</style>