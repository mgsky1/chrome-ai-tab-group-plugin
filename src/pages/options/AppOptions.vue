<template>
  <div class="container">
    <h1>AI标签分组设置</h1>
    <p class="subtitle">配置AI供应商和API密钥</p>

    <!-- 高级管理区域 -->
    <div class="management-section">
      <router-link to="/provider-types" class="btn" style="text-decoration: none;">管理AI供应商类型</router-link>
    </div>

    <!-- 添加/编辑供应商表单 -->
    <form id="settingsForm" @submit.prevent="saveConfig">
      <div class="form-group">
        <label for="aiProvider">AI供应商</label>
        <select id="aiProvider" name="aiProvider" v-model="selectedProviderType">
          <option v-for="(info, type) in providerTypes" :key="type" :value="type">
            {{ info?.name }}
          </option>
        </select>
        <div class="help-text">选择用于智能分组的AI服务提供商</div>
      </div>

      <div class="form-group" v-if="selectedProviderType && providerTypes[selectedProviderType]">
        <label for="apiKey">{{ providerTypes[selectedProviderType]?.name }} API Key</label>
        <input type="password" id="apiKey" name="apiKey" placeholder="请输入您的API Key" v-model="apiKey" required>
        <div style="margin: 10px;"></div>
        <label for="aiModel">调用的AI模型</label>
        <input type="text" id="aiModel" name="aiModel" placeholder="请输入要调用的模型" v-model="aiModel" required>
        <div class="default-provider-group">
          <label for="isDefault">
            <input type="checkbox" id="isDefault" name="isDefault" v-model="isDefault">
            <span>设为默认供应商</span>
          </label>
        </div>
        <div class="help-text">
          获取API Key和模型:
          <a :href="providerTypes[selectedProviderType]?.helpUrl" target="_blank" class="api-key-link">
            {{ providerTypes[selectedProviderType]?.helpUrl }}
          </a>
        </div>
      </div>

      <button type="submit" class="btn">{{ editingProviderId ? '更新设置' : '保存设置' }}</button>
    </form>

    <div v-if="statusMessage" :class="['status', statusType]">
      {{ statusMessage }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import {
  loadAiConfig,
  saveProvider,
  getProviderByType,
  loadProviderTypesConfig,
  type ProviderType,
  type ProviderTypesConfig,
} from '../../background/configStorage';
import type { AiProvider } from '../../background/aiServive';

const providerTypes = ref<ProviderTypesConfig>({});
const providers = ref<AiProvider[]>([]);
const selectedProviderType = ref<ProviderType>('openrouter');
const apiKey = ref('');
const aiModel = ref('');
const isDefault = ref(false);
const editingProviderId = ref<string | null>(null);
const statusMessage = ref('');
const statusType = ref<'success' | 'error'>('success');

// 监听供应商类型变化，加载对应配置
watch(selectedProviderType, async (newType) => {
  await loadProviderConfig(newType);
});

// 加载已配置的供应商列表
async function loadProviders() {
  try {
    const config = await loadAiConfig();
    providers.value = config.providers || [];
  } catch (error) {
    showStatus('加载配置失败: ' + (error as Error).message, 'error');
  }
}

// 加载供应商类型配置
async function loadProviderTypes() {
  try {
    const types = await loadProviderTypesConfig();
    providerTypes.value = types;
  } catch (error) {
    showStatus('加载供应商类型失败: ' + (error as Error).message, 'error');
  }
}


// 加载指定供应商类型的配置
async function loadProviderConfig(providerType: ProviderType) {
  try {
    const existingProvider = await getProviderByType(providerType);
    if (existingProvider) {
      apiKey.value = existingProvider.key;
      aiModel.value = existingProvider.model;
      isDefault.value = existingProvider.isDefault || false;
      editingProviderId.value = existingProvider.id;
    } else {
      // 清空表单
      apiKey.value = '';
      aiModel.value = '';
      isDefault.value = providers.value.length === 0; // 如果没有供应商，默认设为默认
      editingProviderId.value = null;
    }
  } catch (error) {
    console.error('加载供应商配置失败:', error);
  }
}

// 保存配置
async function saveConfig() {
  try {
    if (!selectedProviderType.value || !apiKey.value || !aiModel.value) {
      showStatus('请填写完整信息', 'error');
      return;
    }

    await saveProvider(
      selectedProviderType.value,
      apiKey.value,
      aiModel.value,
      isDefault.value
    );

    await loadProviders();
    await loadProviderConfig(selectedProviderType.value);
    showStatus('保存成功', 'success');
  } catch (error) {
    showStatus('保存失败: ' + (error as Error).message, 'error');
  }
}

// 显示状态消息
function showStatus(message: string, type: 'success' | 'error') {
  statusMessage.value = message;
  statusType.value = type;
  setTimeout(() => {
    statusMessage.value = '';
  }, 3000);
}

// 初始化
onMounted(async () => {
  await loadProviderTypes();
  await loadProviders();
  
  // 确保选中的供应商类型存在
  const availableTypes = Object.keys(providerTypes.value);
  if (availableTypes.length > 0 && !availableTypes.includes(selectedProviderType.value)) {
    selectedProviderType.value = availableTypes[0] as ProviderType;
  }
  
  await loadProviderConfig(selectedProviderType.value);
});
</script>

<style scoped>
.providers-section {
  margin-bottom: 30px;
}

.providers-section h2 {
  font-size: 20px;
  color: #333;
  margin-bottom: 15px;
}

.providers-list {
  display: flex;
  flex-direction: column;
  gap: 15px;
  margin-bottom: 20px;
}

.provider-card {
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  padding: 15px;
  background: #f8f9fa;
  transition: border-color 0.3s, box-shadow 0.3s;
}

.provider-card:hover {
  border-color: #667eea;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.2);
}

.provider-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.provider-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.provider-name {
  font-weight: 600;
  font-size: 16px;
  color: #333;
}

.default-badge {
  background: #667eea;
  color: white;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.provider-actions {
  display: flex;
  gap: 8px;
}

.btn-small {
  background: #667eea;
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.btn-small:hover {
  background: #5568d3;
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.btn-danger {
  background: #dc3545;
}

.btn-danger:hover {
  background: #c82333;
}

.provider-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-item {
  display: flex;
  gap: 10px;
  font-size: 14px;
}

.detail-label {
  color: #666;
  font-weight: 500;
  min-width: 80px;
}

.detail-value {
  color: #333;
  word-break: break-all;
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

/* 高级管理样式 */
.management-section {
  margin-bottom: 30px;
  padding: 20px;
  background: #f8f9fa;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
}

.management-section h2 {
  font-size: 20px;
  color: #333;
  margin-bottom: 15px;
  margin-top: 0;
}

.btn-secondary {
  background: #6c757d;
}

.btn-secondary:hover {
  background: #5a6268;
}
</style>