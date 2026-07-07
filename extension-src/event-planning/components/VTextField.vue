<template>
  <label class="pulse-plus-text-field">
    <span v-if="prependInnerIcon" class="pulse-plus-text-field__icon" aria-hidden="true">
      <VIcon :icon="prependInnerIcon" size="16" />
    </span>
    <input
      :value="modelValue"
      :placeholder="placeholder"
      :autocomplete="autocomplete"
      :autocapitalize="autocapitalize"
      :autocorrect="autocorrect"
      :spellcheck="spellcheck"
      :autofocus="autofocus"
      type="text"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    >
  </label>
</template>

<script setup lang="ts">
import VIcon from './VIcon.vue';

withDefaults(defineProps<{
  modelValue?: string;
  prependInnerIcon?: string;
  placeholder?: string;
  autocomplete?: string;
  autocapitalize?: string;
  autocorrect?: string;
  spellcheck?: boolean | 'true' | 'false';
  autofocus?: boolean;
}>(), {
  modelValue: '',
  prependInnerIcon: '',
  placeholder: '',
  autocomplete: 'off',
  autocapitalize: 'off',
  autocorrect: 'off',
  spellcheck: false,
  autofocus: false
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();
</script>
