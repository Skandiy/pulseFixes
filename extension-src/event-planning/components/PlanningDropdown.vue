<script setup lang="ts">
import { computed, nextTick, ref, watch, type PropType } from 'vue';

type DropdownValue = string | number | null;
type DropdownModelValue = DropdownValue | DropdownValue[];

type DropdownItem = {
  title: string;
  value: string | number;
  avatarUrl?: string;
};

const props = defineProps({
  label: {
    type: String,
    required: true
  },
  items: {
    type: Array as PropType<DropdownItem[]>,
    required: true
  },
  modelValue: {
    type: [String, Number, Array] as PropType<DropdownModelValue>,
    default: null
  },
  multiple: {
    type: Boolean,
    default: false
  },
  searchable: {
    type: Boolean,
    default: true
  },
  grouped: {
    type: Boolean,
    default: true
  },
  searchPlaceholder: {
    type: String,
    default: 'Поиск'
  },
  placeholder: {
    type: String,
    default: 'Не выбрано'
  },
  width: {
    type: Number,
    default: 320
  },
  showReset: {
    type: Boolean,
    default: true
  },
  showApply: {
    type: Boolean,
    default: true
  },
  resetValue: {
    type: [String, Number, Array] as PropType<DropdownModelValue>,
    default: null
  },
  resetText: {
    type: String,
    default: 'Сбросить'
  },
  applyText: {
    type: String,
    default: 'Применить'
  },
  hasMore: {
    type: Boolean,
    default: false
  },
  loading: {
    type: Boolean,
    default: false
  },
  loadingMore: {
    type: Boolean,
    default: false
  },
  remoteSearch: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits<{
  'update:modelValue': [value: DropdownModelValue];
  loadMore: [];
  searchChange: [value: string];
  close: [];
}>();

const isOpen = ref(false);
const search = ref('');
const draftValue = ref<DropdownModelValue>(cloneValue(props.modelValue));

const menuStyle = computed(() => ({
  minWidth: `${props.width}px`,
  width: `${props.width}px`
}));

const selectedValues = computed(() => normalizeValue(props.modelValue));
const draftValues = computed(() => normalizeValue(draftValue.value));

const selectedItems = computed(() => {
  const values = new Set(selectedValues.value);
  return props.items.filter((item) => values.has(item.value));
});

const selectedTitle = computed(() => selectedItems.value[0]?.title ?? props.placeholder);
const selectedExtraCount = computed(() => Math.max(selectedItems.value.length - 1, 0));
const hasSelection = computed(() => selectedItems.value.length > 0);

const filteredItems = computed(() => {
  if (props.remoteSearch) {
    return props.items;
  }
  const query = search.value.trim().toLocaleLowerCase('ru-RU');
  if (!query) {
    return props.items;
  }
  return props.items.filter((item) => item.title.toLocaleLowerCase('ru-RU').includes(query));
});

const selectedGroupItems = computed(() => {
  const values = new Set(selectedValues.value);
  return filteredItems.value.filter((item) => values.has(item.value));
});
const unselectedGroupItems = computed(() => {
  const values = new Set(selectedValues.value);
  return filteredItems.value.filter((item) => !values.has(item.value));
});

watch(isOpen, (open) => {
  if (!open) {
    search.value = '';
    emit('searchChange', '');
    emit('close');
    return;
  }
  draftValue.value = cloneValue(props.modelValue);
  search.value = '';
  emit('searchChange', '');
});

watch(search, (value) => {
  emit('searchChange', value);
});

watch(
  () => props.modelValue,
  (value) => {
    if (!isOpen.value) {
      draftValue.value = cloneValue(value);
    }
  },
  { deep: true }
);

function cloneValue(value: DropdownModelValue): DropdownModelValue {
  return Array.isArray(value) ? [...value] : value;
}

function normalizeValue(value: DropdownModelValue): Array<string | number> {
  if (Array.isArray(value)) {
    return value.filter((item): item is string | number => item !== null);
  }
  return value === null ? [] : [value];
}

function isDraftSelected(value: string | number): boolean {
  return draftValues.value.includes(value);
}

function selectItem(value: string | number): void {
  if (props.multiple) {
    const nextValues = isDraftSelected(value)
      ? draftValues.value.filter((item) => item !== value)
      : [...draftValues.value, value];
    draftValue.value = nextValues;
    if (!props.showApply) {
      emit('update:modelValue', [...nextValues]);
    }
    return;
  }

  draftValue.value = value;
  if (!props.showApply) {
    emit('update:modelValue', value);
    isOpen.value = false;
  }
}

async function closeAndApply(value: DropdownModelValue): Promise<void> {
  isOpen.value = false;
  await nextTick();
  emit('update:modelValue', cloneValue(value));
}

function resetSelection(): void {
  const value = cloneValue(props.resetValue);
  draftValue.value = value;
  void closeAndApply(value);
}

function applySelection(): void {
  void closeAndApply(draftValue.value);
}

function onListScroll(event: Event): void {
  if (!props.hasMore || props.loading || props.loadingMore) {
    return;
  }
  const element = event.currentTarget;
  if (!(element instanceof HTMLElement)) {
    return;
  }
  const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
  const preloadDistance = Math.max(element.clientHeight * 1.5, 360);
  if (distanceToBottom <= preloadDistance) {
    emit('loadMore');
  }
}
</script>

<template>
  <v-menu
    v-model="isOpen"
    :close-on-content-click="false"
    content-class="planning-select-menu planning-dropdown-menu"
    location="bottom start"
    offset="4"
  >
    <template #activator="{ props: activatorProps }">
      <button
        type="button"
        class="planning-filter-button"
        :class="{ active: hasSelection }"
        v-bind="activatorProps"
      >
        <span class="planning-filter-name">{{ label }}</span>
        <span v-if="hasSelection" class="planning-filter-value">: {{ selectedTitle }}</span>
        <span v-if="selectedExtraCount" class="planning-filter-badge">+{{ selectedExtraCount }}</span>
        <span class="planning-filter-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z" />
          </svg>
        </span>
      </button>
    </template>

    <div class="planning-select-list planning-dropdown-list" :style="menuStyle">
      <div v-if="searchable" class="planning-dropdown-search">
        <v-text-field
          v-model="search"
          prepend-inner-icon="mdi-magnify"
          :placeholder="searchPlaceholder"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          density="compact"
          variant="outlined"
          hide-details
          autofocus
        />
      </div>

      <div class="planning-dropdown-scroll-shell">
        <div v-if="loading || loadingMore" class="planning-dropdown-progress" aria-hidden="true">
          <span />
        </div>

        <div class="planning-select-list__list" @scroll="onListScroll">
          <div v-if="filteredItems.length === 0 && !loading && !loadingMore" class="planning-dropdown-empty">Ничего не найдено</div>
          <template v-else-if="!grouped">
            <button
              v-for="item in filteredItems"
              :key="item.value"
              type="button"
              class="planning-select-list__item planning-select-list__item--record"
              :class="{ active: isDraftSelected(item.value) }"
              @click="selectItem(item.value)"
            >
              <span class="planning-select-list__item-title">{{ item.title }}</span>
            </button>
          </template>
          <template v-else>
            <div v-if="selectedGroupItems.length" class="planning-dropdown-group-title">Выбранные</div>
            <template v-if="multiple">
              <label
                v-for="item in selectedGroupItems"
                :key="item.value"
                class="planning-select-list__item planning-select-list__item--record planning-check-item"
              >
                <input
                  type="checkbox"
                  class="planning-check-item__checkbox"
                  :checked="isDraftSelected(item.value)"
                  @change="selectItem(item.value)"
                >
                <slot name="item" :item="item" :selected="isDraftSelected(item.value)">
                  <span class="planning-select-list__item-title">{{ item.title }}</span>
                </slot>
              </label>
            </template>
            <template v-else>
              <button
                v-for="item in selectedGroupItems"
                :key="item.value"
                type="button"
                class="planning-select-list__item planning-select-list__item--record active"
                @click="selectItem(item.value)"
              >
                <slot name="item" :item="item" :selected="isDraftSelected(item.value)">
                  <span class="planning-select-list__item-title">{{ item.title }}</span>
                </slot>
              </button>
            </template>

            <div v-if="unselectedGroupItems.length" class="planning-dropdown-group-title">Невыбранные</div>
            <template v-if="multiple">
              <label
                v-for="item in unselectedGroupItems"
                :key="item.value"
                class="planning-select-list__item planning-select-list__item--record planning-check-item"
              >
                <input
                  type="checkbox"
                  class="planning-check-item__checkbox"
                  :checked="isDraftSelected(item.value)"
                  @change="selectItem(item.value)"
                >
                <slot name="item" :item="item" :selected="isDraftSelected(item.value)">
                  <span class="planning-select-list__item-title">{{ item.title }}</span>
                </slot>
              </label>
            </template>
            <template v-else>
              <button
                v-for="item in unselectedGroupItems"
                :key="item.value"
                type="button"
                class="planning-select-list__item planning-select-list__item--record"
                @click="selectItem(item.value)"
              >
                <slot name="item" :item="item" :selected="isDraftSelected(item.value)">
                  <span class="planning-select-list__item-title">{{ item.title }}</span>
                </slot>
              </button>
            </template>
          </template>
        </div>
      </div>

      <div v-if="showReset || showApply" class="planning-dropdown-actions">
        <button
          v-if="showReset"
          type="button"
          class="planning-dropdown-action"
          @click="resetSelection"
        >
          {{ resetText }}
        </button>
        <button
          v-if="showApply"
          type="button"
          class="planning-dropdown-action primary"
          @click="applySelection"
        >
          {{ applyText }}
        </button>
      </div>
    </div>
  </v-menu>
</template>
