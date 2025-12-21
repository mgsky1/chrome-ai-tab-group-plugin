<template>
    <div class="container">
        <h1>AI标签分组</h1>
        <p class="description">智能分组您的浏览器标签页</p>
        
        <button id="groupBtn" class="btn">立即分组</button>
        <button id="settingsBtn" class="btn btn-secondary" @click="toSettings">打开设置</button>
        
        <div id="status" class="status"></div>
    </div>
</template>

<script setup lang="ts">
    function toSettings() {
        chrome.runtime.openOptionsPage();
    }
</script>

<style scoped></style>