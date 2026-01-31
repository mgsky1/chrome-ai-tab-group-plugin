<template>
    <div class="container">
        <h1>AI标签分组</h1>
        <p class="description">智能分组您的浏览器标签页</p>

        <!-- 总结进度显示 -->
        <div v-if="showProgress" class="progress-container">
            <div class="progress-info">
                <p>总结进度: {{ summaryStatus.completed }}/{{ summaryStatus.total }}</p>
                <div class="progress-bar">
                    <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
                </div>
                <p v-if="summaryStatus.processing > 0" class="processing-info">
                    正在处理: {{ summaryStatus.processing }} 个标签页
                </p>
            </div>
            <div class="progress-actions">
                <button class="btn btn-wait" @click="waitAndGroup" :disabled="isGrouping">
                    等待总结完成
                </button>
                <button class="btn btn-continue" @click="continueGroup" :disabled="isGrouping">
                    使用已有结果继续
                </button>
            </div>
        </div>

        <!-- 正常分组按钮 -->
        <button v-else id="groupBtn" class="btn" @click="checkAndGroup" :disabled="isGrouping">
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
const showProgress = ref(false)
const summaryStatus = ref({
    completed: 0,
    processing: 0,
    pending: 0,
    noSummary: 0,
    total: 0
})

// 进度更新定时器
let progressUpdateTimer: number | null = null

const progressPercent = computed(() => {
    if (summaryStatus.value.total === 0) return 100
    return Math.round((summaryStatus.value.completed / summaryStatus.value.total) * 100)
})

function toSettings() {
    chrome.runtime.openOptionsPage();
}

async function checkSummaryStatus() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'checkSummaryStatus' });
        if (response && response.success) {
            summaryStatus.value = response.status
            // 如果有正在处理或待处理的标签页，显示进度
            if (response.status.processing > 0 || response.status.pending > 0) {
                showProgress.value = true
                // 启动实时更新
                startProgressUpdate()
            } else {
                showProgress.value = false
                // 停止实时更新
                stopProgressUpdate()
            }
        }
    } catch (error: any) {
        console.error('检查总结状态失败:', error)
    }
}

/**
 * 启动进度实时更新
 */
function startProgressUpdate() {
    // 如果已经有定时器在运行，先清除
    stopProgressUpdate()

    // 每 1 秒更新一次进度
    progressUpdateTimer = window.setInterval(async () => {
        try {
            const response = await chrome.runtime.sendMessage({ action: 'checkSummaryStatus' });
            if (response && response.success) {
                summaryStatus.value = response.status
                // 如果所有任务都完成了，停止更新
                if (response.status.processing === 0 && response.status.pending === 0) {
                    stopProgressUpdate()
                    showProgress.value = false
                }
            }
        } catch (error: any) {
            console.error('更新进度失败:', error)
        }
    }, 1000)
}

/**
 * 停止进度实时更新
 */
function stopProgressUpdate() {
    if (progressUpdateTimer !== null) {
        clearInterval(progressUpdateTimer)
        progressUpdateTimer = null
    }
}

async function checkAndGroup() {
    // 立即显示加载状态，给用户反馈
    isGrouping.value = true
    statusEl.value = '正在检查总结状态...'

    try {
        // 先检查总结状态
        await checkSummaryStatus()

        // 如果有正在处理的标签页，显示进度选项
        if (summaryStatus.value.processing > 0 || summaryStatus.value.pending > 0) {
            isGrouping.value = false // 重置状态，让用户可以选择
            showProgress.value = true
            statusEl.value = `检测到 ${summaryStatus.value.processing + summaryStatus.value.pending} 个标签页正在总结中，请选择操作方式`
            return
        }

        // 如果没有正在处理的，直接分组
        await groupTabs(false)
    } catch (error: any) {
        isGrouping.value = false
        statusEl.value = '检查状态失败: ' + error.message
    }
}

async function waitAndGroup() {
    isGrouping.value = true
    statusEl.value = '等待总结完成中...'
    showProgress.value = false

    // 轮询检查总结状态，直到完成
    const maxWaitTime = 60000 // 最多等待 60 秒
    const startTime = Date.now()
    const checkInterval = setInterval(async () => {
        await checkSummaryStatus()
        if (summaryStatus.value.processing === 0 && summaryStatus.value.pending === 0) {
            clearInterval(checkInterval)
            await groupTabs(true)
        } else if (Date.now() - startTime > maxWaitTime) {
            clearInterval(checkInterval)
            statusEl.value = '等待超时，使用已有结果继续分组'
            await groupTabs(false)
        }
    }, 1000)
}

async function continueGroup() {
    showProgress.value = false
    stopProgressUpdate() // 停止进度更新
    await groupTabs(false)
}

async function groupTabs(waitForSummary: boolean = false) {
    isGrouping.value = true
    statusEl.value = '正在分组...';
    try {
        // 发送消息给background script执行分组
        const response = await chrome.runtime.sendMessage({
            action: 'groupTabs',
            waitForSummary: waitForSummary
        });
        if (response && response.success) {
            statusEl.value = '分组完成！';
        } else {
            statusEl.value = '分组失败: ' + (response?.error || '未知错误');
        }
    } catch (error: any) {
        statusEl.value = '分组失败: ' + error.message;
    } finally {
        isGrouping.value = false
    }
}

// 组件挂载时检查总结状态
onMounted(() => {
    checkSummaryStatus()
})

// 组件卸载时清理定时器
onUnmounted(() => {
    stopProgressUpdate()
})
</script>

<style scoped>
.progress-container {
    margin: 16px 0;
    padding: 12px;
    background: #f5f5f5;
    border-radius: 8px;
}

.progress-info {
    margin-bottom: 12px;
}

.progress-bar {
    width: 100%;
    height: 8px;
    background: #e0e0e0;
    border-radius: 4px;
    overflow: hidden;
    margin: 8px 0;
}

.progress-fill {
    height: 100%;
    background: #4caf50;
    transition: width 0.3s ease;
}

.processing-info {
    font-size: 12px;
    color: #666;
    margin-top: 4px;
}

.progress-actions {
    display: flex;
    gap: 8px;
}

.btn-wait {
    flex: 1;
    background: #2196f3;
    color: white;
}

.btn-continue {
    flex: 1;
    background: #ff9800;
    color: white;
}

.btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}
</style>