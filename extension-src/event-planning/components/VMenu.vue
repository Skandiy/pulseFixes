<template>
  <span ref="menuRoot" class="pulse-plus-menu">
    <slot name="activator" :props="activatorProps" />
    <Teleport to="body">
      <Transition :name="transition">
        <div
          v-if="modelValue"
          ref="contentElement"
          class="pulse-plus-event-planning-menu-content"
          :class="contentClass"
          :style="contentStyle"
          @click="onContentClick"
        >
          <slot />
        </div>
      </Transition>
    </Teleport>
  </span>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = withDefaults(defineProps<{
  modelValue: boolean;
  closeOnContentClick?: boolean;
  contentClass?: string;
  location?: string;
  offset?: string | number;
  transition?: string;
}>(), {
  closeOnContentClick: true,
  contentClass: '',
  location: 'bottom start',
  offset: 4,
  transition: ''
});

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const menuRoot = ref<HTMLElement | null>(null);
const contentElement = ref<HTMLElement | null>(null);
const contentStyle = ref<Record<string, string>>({
  position: 'fixed',
  top: '0px',
  left: '0px',
  zIndex: '2147483000'
});

const activatorProps = computed(() => ({
  'aria-expanded': String(props.modelValue),
  onClick: (event: MouseEvent) => {
    event.preventDefault();
    emit('update:modelValue', !props.modelValue);
  }
}));

function readOffset(): number {
  return Number(props.offset) || 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function updatePosition(): void {
  const root = menuRoot.value;
  if (!root) {
    return;
  }

  const viewportPadding = 8;
  const offset = readOffset();
  const rootRect = root.getBoundingClientRect();
  const contentRect = contentElement.value?.getBoundingClientRect();
  const contentWidth = contentRect?.width || rootRect.width;
  const contentHeight = contentRect?.height || 0;
  const location = props.location.toLowerCase();

  let left = rootRect.left;
  if (location.includes('end')) {
    left = rootRect.right - contentWidth;
  } else if (location.includes('center')) {
    left = rootRect.left + (rootRect.width - contentWidth) / 2;
  }

  let top = rootRect.bottom + offset;
  if (contentHeight && top + contentHeight > window.innerHeight - viewportPadding) {
    const topCandidate = rootRect.top - contentHeight - offset;
    if (topCandidate >= viewportPadding) {
      top = topCandidate;
    }
  }

  const maxLeft = Math.max(viewportPadding, window.innerWidth - contentWidth - viewportPadding);
  const maxTop = Math.max(viewportPadding, window.innerHeight - viewportPadding);

  contentStyle.value = {
    position: 'fixed',
    top: `${Math.round(clamp(top, viewportPadding, maxTop))}px`,
    left: `${Math.round(clamp(left, viewportPadding, maxLeft))}px`,
    minWidth: `${Math.ceil(rootRect.width)}px`,
    zIndex: '2147483000'
  };
}

function onDocumentPointerDown(event: PointerEvent): void {
  const target = event.target as Node;
  if (
    !props.modelValue
    || menuRoot.value?.contains(target)
    || contentElement.value?.contains(target)
  ) {
    return;
  }
  emit('update:modelValue', false);
}

function onContentClick(): void {
  if (props.closeOnContentClick) {
    emit('update:modelValue', false);
  }
}

function onViewportChange(): void {
  if (props.modelValue) {
    updatePosition();
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('scroll', onViewportChange, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  window.removeEventListener('resize', onViewportChange);
  window.removeEventListener('scroll', onViewportChange, true);
});

watch(() => props.modelValue, async (isOpen) => {
  if (!isOpen) {
    return;
  }

  await nextTick();
  updatePosition();
  window.requestAnimationFrame(updatePosition);
});
</script>
