<template>
  <div class="container">
    <h1>自定义词库</h1>
    <p class="subtitle">添加专有名词、品牌名或技术术语，确保分词时不被拆分</p>

    <div class="add-section">
      <div class="input-row">
        <input
          type="text"
          v-model="newWord"
          placeholder="输入词语，如：Claude、OpenAI、大语言模型"
          @keyup.enter="addWord"
          class="word-input"
        />
        <button @click="addWord" class="btn add-btn">添加</button>
      </div>
      <div v-if="addError" class="status error">{{ addError }}</div>
    </div>

    <div class="words-section">
      <h2>已添加的词语（{{ words.length }} 个）</h2>
      <div v-if="words.length === 0" class="empty-tip">暂无自定义词语</div>
      <div v-else class="words-list">
        <div v-for="(word, index) in words" :key="index" class="word-item">
          <span class="word-text">{{ word }}</span>
          <button @click="removeWord(index)" class="btn-remove">删除</button>
        </div>
      </div>
    </div>

    <div v-if="statusMessage" :class="['status', statusType]">
      {{ statusMessage }}
    </div>

    <div style="margin-top: 20px;">
      <router-link to="/">← 返回设置</router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { loadCustomDict, saveCustomDict } from '../../background/configStorage';

const words = ref<string[]>([]);
const newWord = ref('');
const addError = ref('');
const statusMessage = ref('');
const statusType = ref<'success' | 'error'>('success');

async function loadWords() {
  try {
    words.value = await loadCustomDict();
  } catch (error) {
    showStatus('加载词库失败: ' + (error as Error).message, 'error');
  }
}

async function addWord() {
  const word = newWord.value.trim();
  addError.value = '';

  if (!word) {
    addError.value = '请输入词语';
    return;
  }
  if (words.value.includes(word)) {
    addError.value = '该词语已存在';
    return;
  }

  words.value.push(word);
  newWord.value = '';

  try {
    await saveCustomDict(words.value);
    showStatus('已添加: ' + word, 'success');
  } catch (error) {
    words.value.pop();
    showStatus('保存失败: ' + (error as Error).message, 'error');
  }
}

async function removeWord(index: number) {
  const removed = words.value.splice(index, 1)[0];
  try {
    await saveCustomDict(words.value);
    showStatus('已删除: ' + removed, 'success');
  } catch (error) {
    words.value.splice(index, 0, removed!);
    showStatus('删除失败: ' + (error as Error).message, 'error');
  }
}

function showStatus(message: string, type: 'success' | 'error') {
  statusMessage.value = message;
  statusType.value = type;
  setTimeout(() => {
    statusMessage.value = '';
  }, 3000);
}

onMounted(async () => {
  await loadWords();
});
</script>

<style scoped>
.add-section {
  margin-bottom: 30px;
}

.input-row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.add-btn {
  flex-shrink: 0;
  width: auto;
  min-width: unset;
  padding: 10px 20px;
  white-space: nowrap;
}

.word-input {
  flex: 1;
  min-width: 0;
  padding: 10px 14px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.word-input:focus {
  border-color: #667eea;
}

.words-section h2 {
  font-size: 16px;
  color: #333;
  margin-bottom: 12px;
}

.empty-tip {
  color: #999;
  font-size: 14px;
  padding: 20px 0;
}

.words-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.word-item {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #f0f2ff;
  border: 1px solid #d0d5f0;
  border-radius: 20px;
  padding: 6px 12px;
}

.word-text {
  font-size: 14px;
  color: #333;
}

.btn-remove {
  background: none;
  border: none;
  color: #999;
  cursor: pointer;
  font-size: 12px;
  padding: 0 2px;
  transition: color 0.2s;
}

.btn-remove:hover {
  color: #dc3545;
}

.status {
  margin-top: 16px;
  padding: 10px 14px;
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
