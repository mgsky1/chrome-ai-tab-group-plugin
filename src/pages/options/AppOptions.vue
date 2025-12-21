<template>
  <div class="container">
    <h1>AI标签分组设置</h1>
    <p class="subtitle">配置AI供应商和API密钥</p>

    <form id="settingsForm">
      <div class="form-group">
        <label for="aiProvider">AI供应商</label>
        <select id="aiProvider" name="aiProvider">
          <option value="openrouter">openrouter</option>
        </select>
        <div class="help-text">选择用于智能分组的AI服务提供商</div>
      </div>

      <div class="form-group" id="openrouterConfig">
        <label for="openrouterApiKey">OpenRouter API Key</label>
        <input 
          type="password" 
          id="openrouterApiKey" 
          name="openrouterApiKey" 
          placeholder="请输入您的OpenRouter API Key"
        >
        <div style="margin: 10px;"></div>
        <label for="openrouterModel">调用的AI模型</label>
        <input 
          type="text" 
          id="openrouterModel" 
          name="openrouterModel" 
          placeholder="请输入要调用的模型"
        >
        <div class="default-provider-group">
          <label for="openrouterDefaultProvider">
            <input 
              type="checkbox" 
              id="openrouterDefaultProvider" 
              name="openrouterDefaultProvider"
            >
            <span>设为默认供应商</span>
          </label>
        </div>
        <div class="help-text">
          获取API Key和模型: 
          <a href="https://openrouter.ai/" target="_blank" class="api-key-link">
            https://openrouter.ai/
          </a>
        </div>
      </div>

      <button type="submit" class="btn">保存设置</button>
    </form>

    <div id="status" class="status"></div>
  </div>
</template>

<script setup lang="ts"></script>

<style scoped>

</style>