<template>
  <div class="container">
    <h1>AI供应商类型管理</h1>
    <p class="subtitle">管理AI供应商类型配置</p>

    <!-- 供应商类型管理区域 -->
    <div class="providers-section">
      <div class="section-header">
        <button type="button" class="btn" @click="showAddProviderTypeForm">添加供应商类型</button>
      </div>

      <!-- 供应商类型列表 -->
      <div class="providers-list">
        <div v-for="(info, type) in providerTypes" :key="type" class="provider-card">
          <div class="provider-header">
            <div class="provider-info">
              <span class="provider-name">{{ info?.name }}</span>
              <span class="provider-type">({{ type }})</span>
            </div>
            <div class="provider-actions">
              <button type="button" class="btn-small" @click="editProviderType(String(type))">编辑</button>
              <button type="button" class="btn-small btn-danger"
                @click="deleteProviderTypeHandler(String(type))">删除</button>
            </div>
          </div>
          <div class="provider-details">
            <div class="detail-item">
              <span class="detail-label">baseURL(用于发起API调用):</span>
              <span class="detail-value">{{ info?.baseUrl }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">帮助URL(可选):</span>
              <span class="detail-value">{{ info?.helpUrl }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 添加/编辑供应商类型表单 -->
    <div v-if="showProviderTypeForm" class="provider-type-form">
      <h3>{{ editingProviderTypeKey ? '编辑供应商类型' : '添加新供应商类型' }}</h3>
      <form @submit.prevent="saveProviderType">
        <div class="form-group">
          <label for="providerTypeKey">供应商类型键值</label>
          <input type="text" id="providerTypeKey" v-model="newProviderTypeKey" :disabled="!!editingProviderTypeKey"
            placeholder="例如: openai, anthropic" required>
          <div class="help-text">供应商类型的唯一标识符，不能修改</div>
        </div>

        <div class="form-group">
          <label for="providerTypeBaseUrl">baseURL(用于发起API调用)</label>
          <input type="url" id="providerTypeBaseUrl" v-model="newProviderTypeBaseUrl"
            placeholder="https://api.openai.com/v1" required>
        </div>

        <div class="form-group">
          <label for="providerTypeHelpUrl">帮助URL(可选)</label>
          <input type="url" id="providerTypeHelpUrl" v-model="newProviderTypeHelpUrl"
            placeholder="https://platform.openai.com/docs">
        </div>

        <div class="form-actions">
          <button type="submit" class="btn">{{ editingProviderTypeKey ? '更新' : '添加' }}</button>
          <button type="button" class="btn btn-secondary" @click="cancelProviderTypeForm">取消</button>
        </div>
      </form>
    </div>

    <!-- 导航按钮 -->
    <div class="navigation-section">
      <router-link to="/" class="btn secondary" style="text-decoration: none;">返回供应商类型列表</router-link>
    </div>

    <!-- 状态消息 -->
    <div v-if="statusMessage" :class="['status', statusType]">
      {{ statusMessage }}
    </div>
    <div style="margin-top: 20px;">
      <router-link to="/privacy" style="margin-right: 20px;">隐私政策</router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import {
  getAllProviderTypes,
  addProviderType,
  updateProviderType,
  deleteProviderType,
  type ProviderTypesConfig,
  type ProviderTypeInfo
} from '../../background/configStorage'
import { useRouter } from 'vue-router'

const providerTypes = ref<ProviderTypesConfig>({})
const statusMessage = ref('')
const statusType = ref<'success' | 'error'>('success')
const router = useRouter()

// 供应商类型管理状态
const showProviderTypeForm = ref(false)
const newProviderTypeKey = ref('')
const newProviderTypeBaseUrl = ref('')
const newProviderTypeHelpUrl = ref('')
const editingProviderTypeKey = ref<string | null>(null)

// 显示状态消息
function showStatus(message: string, type: 'success' | 'error') {
  statusMessage.value = message
  statusType.value = type
  setTimeout(() => {
    statusMessage.value = ''
  }, 3000)
}

// 加载供应商类型配置
async function loadProviderTypes() {
  try {
    const types = await getAllProviderTypes()
    providerTypes.value = types
  } catch (error) {
    showStatus('加载供应商类型失败: ' + (error as Error).message, 'error')
  }
}

// 显示供应商类型表单
function showAddProviderTypeForm() {
  showProviderTypeForm.value = true
  editingProviderTypeKey.value = null
  newProviderTypeKey.value = ''
  newProviderTypeBaseUrl.value = ''
  newProviderTypeHelpUrl.value = ''
}

// 编辑供应商类型
function editProviderType(type: string) {
  const info = providerTypes.value[type]
  if (info) {
    showProviderTypeForm.value = true
    editingProviderTypeKey.value = type
    newProviderTypeKey.value = type
    newProviderTypeBaseUrl.value = info.baseUrl
    newProviderTypeHelpUrl.value = info.helpUrl
  }
}

// 保存供应商类型
async function saveProviderType() {
  try {
    if (!newProviderTypeKey.value || !newProviderTypeBaseUrl.value) {
      showStatus('请填写完整信息', 'error')
      return
    }

    const providerInfo: ProviderTypeInfo = {
      name: newProviderTypeKey.value,
      baseUrl: newProviderTypeBaseUrl.value,
      helpUrl: newProviderTypeHelpUrl.value
    }

    if (editingProviderTypeKey.value) {
      // 更新现有供应商类型
      if (editingProviderTypeKey.value !== newProviderTypeKey.value) {
        showStatus('不能修改供应商类型键值', 'error')
        return
      }
      await updateProviderType(newProviderTypeKey.value, providerInfo)
      showStatus('供应商类型更新成功', 'success')
    } else {
      // 添加新供应商类型
      await addProviderType(newProviderTypeKey.value, providerInfo)
      showStatus('供应商类型添加成功', 'success')
    }

    showProviderTypeForm.value = false
    await loadProviderTypes()
  } catch (error) {
    showStatus('保存失败: ' + (error as Error).message, 'error')
  }
}

// 删除供应商类型
async function deleteProviderTypeHandler(type: string) {
  if (!confirm(`确定要删除供应商类型 "${providerTypes.value[type]?.name}" 吗？这将同时删除该类型下所有已配置的用户信息。`)) {
    return
  }

  try {
    await deleteProviderType(type)
    showStatus('供应商类型删除成功', 'success')
    await loadProviderTypes()
  } catch (error) {
    showStatus('删除失败: ' + (error as Error).message, 'error')
  }
}

// 取消供应商类型表单
function cancelProviderTypeForm() {
  showProviderTypeForm.value = false
  editingProviderTypeKey.value = null
  newProviderTypeKey.value = ''
  newProviderTypeBaseUrl.value = ''
  newProviderTypeHelpUrl.value = ''
}

// 返回options页面
function goBackToOptions() {
  router.push('/')
}

// 初始化
onMounted(async () => {
  await loadProviderTypes()
})
</script>

<style scoped>
.container {
  max-width: 800px;
  margin: 0 auto;
  background: white;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  padding: 40px;
}

h1 {
  color: #333;
  margin-bottom: 10px;
  font-size: 28px;
}

.subtitle {
  color: #666;
  margin-bottom: 30px;
  font-size: 14px;
}

/* 供应商类型管理样式 */
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.section-header h2 {
  font-size: 20px;
  color: #333;
  margin: 0;
}

.providers-section {
  margin-bottom: 30px;
}

.providers-list {
  display: grid;
  gap: 15px;
  margin-bottom: 20px;
}

.provider-card {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 15px;
  background: #f8f9fa;
}

.provider-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.provider-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.provider-name {
  font-weight: 600;
  color: #333;
}

.provider-type {
  color: #666;
  font-size: 14px;
  font-weight: normal;
}

.provider-actions {
  display: flex;
  gap: 8px;
}

.provider-details {
  display: grid;
  gap: 5px;
}

.detail-item {
  display: flex;
  gap: 10px;
  font-size: 14px;
}

.detail-label {
  color: #666;
  min-width: 80px;
}

.detail-value {
  color: #333;
  word-break: break-all;
}

.provider-type-form {
  background: #f8f9fa;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 30px;
}

.provider-type-form h3 {
  margin-top: 0;
  margin-bottom: 20px;
  color: #333;
}

.form-group {
  margin-bottom: 20px;
}

label {
  display: block;
  color: #333;
  font-weight: 500;
  margin-bottom: 8px;
  font-size: 14px;
}

input {
  width: 100%;
  padding: 12px;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-size: 14px;
  transition: border-color 0.3s;
}

input:focus {
  outline: none;
  border-color: #667eea;
}

.help-text {
  font-size: 12px;
  color: #999;
  margin-top: 5px;
}

.form-actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}

.btn {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.btn:active {
  transform: translateY(0);
}

.btn-small {
  background: #6c757d;
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-small:hover {
  background: #5a6268;
}

.btn-danger {
  background: #dc3545;
}

.btn-danger:hover {
  background: #c82333;
}

.btn-secondary {
  background: #6c757d;
}

.btn-secondary:hover {
  background: #5a6268;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(108, 117, 125, 0.4);
}

.navigation-section {
  margin-top: 30px;
  padding-top: 20px;
  border-top: 1px solid #e0e0e0;
}

.status {
  margin-top: 20px;
  padding: 12px;
  border-radius: 8px;
  font-size: 14px;
}

.status.success {
  background: #d4edda;
  color: #155724;
  border: 1px solid #c3e6cb;
}

.status.error {
  background: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
}
</style>