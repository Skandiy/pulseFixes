<template>
  <span class="pulse-plus-icon" :style="iconStyle" aria-hidden="true">
    <svg role="img" viewBox="0 0 24 24" class="pulse-plus-icon__svg" focusable="false">
      <path :d="path" />
    </svg>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  icon?: string;
  size?: string | number;
}>(), {
  icon: '',
  size: 24
});

const paths: Record<string, string> = {
  'mdi-arrow-expand': 'M10,21V19H6.41L10.91,14.5L9.5,13.09L5,17.59V14H3V21H10M14.5,10.91L19,6.41V10H21V3H14V5H17.59L13.09,9.5L14.5,10.91Z',
  'mdi-bell-plus-outline': 'M10,21H14A2,2 0 0,1 12,23A2,2 0 0,1 10,21M21,19V20H3V19L5,17V11A7,7 0 0,1 11,4.08V2H13V4.08A7,7 0 0,1 19,11V17L21,19M17,11A5,5 0 0,0 12,6A5,5 0 0,0 7,11V18H17V11M13,8V10H15V12H13V14H11V12H9V10H11V8H13Z',
  'mdi-calendar-month-outline': 'M19,19H5V8H19M16,1V3H8V1H6V3H5C3.89,3 3,3.89 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5C21,3.89 20.1,3 19,3H18V1M17,12H12V17H17V12Z',
  'mdi-cake-variant-outline': 'M12,6C13.11,6 14,6.9 14,8C14,9.11 13.11,10 12,10C10.9,10 10,9.11 10,8C10,6.9 10.9,6 12,6M20,17V19H4V17C4,15.89 4.9,15 6,15H18C19.11,15 20,15.89 20,17M18,13H6V11H18V13M6,21H18V23H6V21M12,2L14,4H10L12,2Z',
  'mdi-chevron-down': 'M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z',
  'mdi-close': 'M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z',
  'mdi-content-copy': 'M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z',
  'mdi-dots-vertical': 'M12,8A2,2 0 0,0 14,6A2,2 0 0,0 12,4A2,2 0 0,0 10,6A2,2 0 0,0 12,8M12,10A2,2 0 0,0 10,12A2,2 0 0,0 12,14A2,2 0 0,0 14,12A2,2 0 0,0 12,10M12,16A2,2 0 0,0 10,18A2,2 0 0,0 12,20A2,2 0 0,0 14,18A2,2 0 0,0 12,16Z',
  'mdi-format-align-left': 'M3,3H21V5H3V3M3,7H15V9H3V7M3,11H21V13H3V11M3,15H15V17H3V15M3,19H21V21H3V19Z',
  'mdi-magnify': 'M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z',
  'mdi-paperclip': 'M16.5,6V17.5A4,4 0 0,1 12.5,21.5A4,4 0 0,1 8.5,17.5V5A2.5,2.5 0 0,1 11,2.5A2.5,2.5 0 0,1 13.5,5V16.5A1,1 0 0,1 12.5,17.5A1,1 0 0,1 11.5,16.5V6H10V16.5A2.5,2.5 0 0,0 12.5,19A2.5,2.5 0 0,0 15,16.5V5A4,4 0 0,0 11,1A4,4 0 0,0 7,5V17.5A5.5,5.5 0 0,0 12.5,23A5.5,5.5 0 0,0 18,17.5V6H16.5Z',
  'mdi-repeat': 'M7,7H18V10L22,6L18,2V5H5V11H7V7M17,17H6V14L2,18L6,22V19H19V13H17V17Z'
};

const path = computed(() => paths[props.icon] ?? paths['mdi-calendar-month-outline']);
const iconStyle = computed(() => {
  const size = typeof props.size === 'number' || /^\d+(\.\d+)?$/.test(String(props.size))
    ? `${props.size}px`
    : props.size;
  return {
    width: size,
    height: size
  };
});
</script>
