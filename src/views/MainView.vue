<script setup lang="ts">
// 主界面：分类侧栏 + 条目列表；最左侧图标导航栏由 AppShell 提供。
import Sidebar from '@/components/layout/Sidebar.vue'
import EntryList from '@/components/layout/EntryList.vue'
</script>

<template>
  <div class="flex h-screen min-h-0 w-full overflow-hidden">
    <Sidebar />
    <EntryList />
  </div>
</template>
