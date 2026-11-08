<script setup lang="ts">
import { NButton, NFlex, NTag, useMessage } from "naive-ui";
import { computed, onBeforeUnmount, ref, watch } from "vue";

import FileDropZone from "./FileDropZone.vue";

import { uploadStageInput, type StageFileInputSlot } from "../api/client";

const props = defineProps<{
  stageName: string;
  slot: StageFileInputSlot;
  modelValue: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const message = useMessage();
const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const uploadedName = ref("");
let uploadContext = 0;
const accept = computed(() => props.slot.extensions.join(","));

onBeforeUnmount(() => { uploadContext += 1; });

watch(
  () => [props.stageName, props.slot.key] as const,
  () => {
    uploadContext += 1;
    uploadedName.value = "";
  },
);

function openFilePicker() {
  fileInput.value?.click();
}

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  try { await uploadFiles(files); }
  finally { input.value = ""; }
}

async function uploadFiles(files: File[]) {
  const file = files[0];
  if (!file || uploading.value) return;

  const context = uploadContext;
  uploading.value = true;
  try {
    const response = await uploadStageInput(props.stageName, props.slot.key, file);
    if (context !== uploadContext) return;
    uploadedName.value = response.name;
    emit("update:modelValue", response.path);
    message.success(`已上传${props.slot.label}：${response.name}`);
  } catch (caught) {
    if (context === uploadContext) message.error(caught instanceof Error ? caught.message : `${props.slot.label}上传失败`);
  } finally {
    uploading.value = false;
  }
}
</script>

<template>
  <FileDropZone :label="slot.label" :accept="accept" :disabled="uploading" @files="uploadFiles">
    <n-flex align="center" :size="8" wrap class="stage-file-upload">
      <input
        ref="fileInput"
        type="file"
        :disabled="uploading"
        :accept="accept"
        class="stage-file-upload__input"
        @change="handleFileChange"
      />
      <n-button secondary type="primary" :loading="uploading" @click="openFilePicker">
        选择{{ slot.label }}
      </n-button>
      <n-tag v-if="uploadedName" size="small" type="success" :bordered="false" class="stage-file-upload__name">
        {{ uploadedName }}
      </n-tag>
    </n-flex>
  </FileDropZone>
</template>

<style scoped>
.stage-file-upload__input {
  display: none;
}

.stage-file-upload { min-width: 0; width: 100%; }
.stage-file-upload__name { max-width: 100%; height: auto; padding-block: 4px; }
.stage-file-upload__name :deep(.n-tag__content) { white-space: normal; overflow-wrap: anywhere; }
</style>
