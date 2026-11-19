<script setup lang="ts" generic="TaskState extends { status: string }">
import { NButton, useMessage } from "naive-ui";
import { ref } from "vue";
import { canStopTask } from "../api/taskStatus";

const props = defineProps<{
  status: string;
  request: () => Promise<TaskState>;
}>();
const emit = defineEmits<{ updated: [state: TaskState] }>();
const message = useMessage();
const submitting = ref(false);

async function stop() {
  submitting.value = true;
  try {
    emit("updated", await props.request());
  } catch (error) {
    message.error(error instanceof Error ? error.message : "停止任务失败");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <n-button v-if="canStopTask(status)" size="small" secondary :loading="submitting" @click.stop="stop">
    停止任务
  </n-button>
</template>
