<script setup lang="ts">
import { computed, ref } from 'vue';
import { errorGuidance, plainErrorHint, redactErrorDetails } from '../utils/errorGuidance';

const props = defineProps<{ error: string; detail?: string; taskId?: string; stage?: string; warning?: boolean; context?: string }>();
const guide = computed(() => errorGuidance(`${props.error}\n${props.detail ?? ''}`));
const copied = ref('');
const support = computed(() => redactErrorDetails([
  `问题：${guide.value.title}`, props.taskId && `任务编号：${props.taskId}`,
  props.stage && `失败步骤：${props.stage}`, `说明：${props.error}`, props.detail,
].filter(Boolean).join('\n')));
async function copy() {
  try { await navigator.clipboard.writeText(support.value); copied.value = '已复制，可发给维护人员'; }
  catch { copied.value = '无法自动复制，请选中下方文字复制'; }
}
</script>

<template>
  <section class="error-help" :class="{ 'is-warning': warning }" role="alert" aria-live="polite">
    <strong>{{ guide.title }}</strong>
    <p>{{ guide.message }}</p>
    <p v-if="plainErrorHint(error)">{{ plainErrorHint(error) }}</p>
    <p v-if="context" class="error-help__context">{{ context }}</p>
    <div class="error-help__label">接下来可以这样做</div>
    <ol><li v-for="step in guide.steps" :key="step">{{ step }}</li></ol>
    <details>
      <summary>求助信息 / 技术详情</summary>
      <p>自己无法解决时，把这些信息发给维护人员即可。</p>
      <button type="button" @click="copy">复制求助信息</button>
      <span role="status">{{ copied }}</span>
      <pre>{{ support }}</pre>
    </details>
  </section>
</template>

<style scoped>
.error-help { padding: 16px; border: 1px solid var(--color-error, #bd4242); border-radius: 12px; background: var(--color-error-bg, rgba(189,66,66,.06)); font-size: 14px; overflow-wrap: anywhere; }
.error-help.is-warning { border-color: var(--color-warning, #b37c16); }
p { margin: 8px 0; }
.error-help__label { font-weight: 600; margin-top: 12px; }
ol { padding-left: 24px; margin: 8px 0 16px; }
li + li { margin-top: 6px; }
summary { cursor: pointer; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; font-size: 12px; max-height: 240px; overflow: auto; }
button { cursor: pointer; font: inherit; color: inherit; padding: 5px 10px; margin-right: 8px; border: 1px solid currentColor; border-radius: 6px; background: transparent; }
</style>
