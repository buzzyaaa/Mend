<script setup lang="ts">
import TopBar from '@/components/layout/TopBar.vue'
import Sidebar from '@/components/layout/Sidebar.vue'
import EntryList from '@/components/layout/EntryList.vue'
</script>

<template>
  <div class="flex h-screen flex-col">
    <TopBar />
    <div class="flex flex-1 overflow-hidden">
      <Sidebar />
      <EntryList />
    </div>
  </div>
</template>
