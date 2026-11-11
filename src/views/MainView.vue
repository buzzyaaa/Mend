<script setup lang="ts">
// 主界面：分类侧栏 + 条目列表；最左侧图标导航栏由 AppShell 提供。
import Sidebar from '@/components/layout/Sidebar.vue'
import EntryList from '@/components/layout/EntryList.vue'
</script>

<template>
  <div class="flex flex-1 overflow-hidden">
    <Sidebar />
    <EntryList />
  </div>
</template>
