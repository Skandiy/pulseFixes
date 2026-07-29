<template>
  <div class="pulse-plus-alert" :class="`pulse-plus-alert--${type}`" role="status">
    <slot />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  type?: 'info' | 'warning' | 'error' | 'success';
}>(), {
  type: 'info'
});
</script>
