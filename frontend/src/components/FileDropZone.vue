<script setup lang="ts">
import { computed, ref } from "vue";
import { useMessage } from "naive-ui";

import { filesFromDrop, hasFileDrag, validateDroppedFiles } from "../utils/fileDrop";

const props = withDefaults(defineProps<{
  label: string;
  accept?: string;
  multiple?: boolean;
  directory?: boolean;
  disabled?: boolean;
}>(), { accept: "", multiple: false, directory: false, disabled: false });
const emit = defineEmits<{ files: [files: File[]] }>();
const message = useMessage();
const depth = ref(0);
const reading = ref(false);
const unavailable = computed(() => props.disabled || reading.value);

function enter(event: DragEvent) {
  if (!hasFileDrag(event)) return;
  event.preventDefault();
  event.stopPropagation();
  if (!unavailable.value) depth.value += 1;
}

function over(event: DragEvent) {
  if (!hasFileDrag(event)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = unavailable.value ? "none" : "copy";
}

function leave(event: DragEvent) {
  if (!hasFileDrag(event)) return;
  event.stopPropagation();
  depth.value = Math.max(0, depth.value - 1);
}

async function drop(event: DragEvent) {
  if (!hasFileDrag(event)) return;
  event.preventDefault();
  event.stopPropagation();
  depth.value = 0;
  if (unavailable.value || !event.dataTransfer) return;
  reading.value = true;
  try {
    const files = await filesFromDrop(event.dataTransfer, props.directory);
    if (props.disabled) return;
    // Directory uploads keep their existing extension filtering and skipped-file count.
    validateDroppedFiles(files, props.directory ? "" : props.accept, props.multiple, props.label);
    emit("files", files);
  } catch (error) {
    message.warning(error instanceof Error ? error.message : "无法读取拖入的文件，请使用选择按钮重试。");
  } finally {
    reading.value = false;
  }
}
</script>

<template>
  <div
    class="file-drop-zone"
    :class="{ 'is-dragging': depth > 0 && !unavailable, 'is-disabled': unavailable }"
    role="region"
    :aria-label="`${label}上传区`"
    :aria-disabled="unavailable"
    @dragenter="enter"
    @dragover="over"
    @dragleave="leave"
    @drop="drop"
  >
    <slot />
    <p class="file-drop-zone__hint">
      {{ reading ? '正在读取拖入的文件…' : `将本地${directory ? '文件或文件夹' : '文件'}拖到此处，作为${label}上传` }}
      <span v-if="!reading">（{{ multiple ? '可拖入多个' : '每次一个文件' }}）</span>
    </p>
  </div>
</template>

<style scoped>
.file-drop-zone {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 12px;
  border: 1px dashed var(--border-strong);
  border-radius: 8px;
  transition: border-color 120ms, background-color 120ms;
}
.file-drop-zone.is-dragging {
  border-color: var(--primary);
  background: var(--primary-alpha-10);
  outline: 2px solid var(--primary);
  outline-offset: -2px;
}
.file-drop-zone.is-disabled { opacity: 0.65; }
.file-drop-zone__hint {
  margin: 8px 0 0;
  color: var(--text-secondary, #62646f);
  font-size: 13px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
</style>
