<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import RobotViewer from './components/RobotViewer.vue'
import { useRobot } from '@/composables/useRobot'
import { JOINT_ORDER } from '@/types/robot'
import type { JointName } from '@/types/robot'

const viewerRef = ref<InstanceType<typeof RobotViewer> | null>(null)
const {
  connect,
  sendCommand,
  reset,
  setTargetAngle,
  isConnected,
  isLoading,
  error,
  currentState,
  targetAngles,
  lastUpdatedAt,
} = useRobot({ pollingInterval: 50 })

const COMMAND_DEBOUNCE_MS = 80
let queuedCommandTimer: number | null = null

const jointList = computed(() =>
  JOINT_ORDER.map((jointName) => ({
    name: jointName,
    target: targetAngles.value[jointName],
    current:
      currentState.value?.joints.find((joint) => joint.joint_name === jointName)?.position ?? targetAngles.value[jointName],
  })),
)

const lastUpdatedLabel = computed(() => {
  if (!lastUpdatedAt.value) {
    return '--'
  }
  return new Date(lastUpdatedAt.value).toLocaleTimeString()
})

const clearQueuedCommand = () => {
  if (queuedCommandTimer !== null) {
    window.clearTimeout(queuedCommandTimer)
    queuedCommandTimer = null
  }
}

const handleSendCommand = async () => {
  if (!isConnected.value) {
    return
  }
  clearQueuedCommand()
  await sendCommand()
}

const queueCommand = () => {
  if (!isConnected.value) {
    return
  }
  clearQueuedCommand()
  queuedCommandTimer = window.setTimeout(() => {
    queuedCommandTimer = null
    void handleSendCommand()
  }, COMMAND_DEBOUNCE_MS)
}

const handleAngleInput = (jointName: JointName, value: number) => {
  setTargetAngle(jointName, value)
  queueCommand()
}

watch(
  () => currentState.value?.joints,
  (joints) => {
    if (!joints?.length) {
      return
    }
    const nextAngles: Record<string, number> = {}
    for (const joint of joints) {
      nextAngles[joint.joint_name] = joint.position
    }
    viewerRef.value?.updateJoints(nextAngles)
  },
  { immediate: true, deep: true },
)

onMounted(async () => {
  if (!isConnected.value) {
    await connect()
  }
})

onUnmounted(() => {
  clearQueuedCommand()
})
</script>

<template>
  <main class="app-layout">
    <section class="viewer-panel">
      <RobotViewer ref="viewerRef" />
    </section>
    <aside class="control-panel">
      <h1>UR5 3D 可视化</h1>
      <p>连接状态：{{ isConnected ? '已连接' : '未连接' }}</p>
      <p>最后更新：{{ lastUpdatedLabel }}</p>
      <p v-if="error" class="error-text">{{ error }}</p>
      <div class="joint-list">
        <label v-for="joint in jointList" :key="joint.name" class="joint-item">
          <span>{{ joint.name }}</span>
          <input
            :value="joint.target"
            type="range"
            min="-3.1416"
            max="3.1416"
            step="0.01"
            :disabled="!isConnected || isLoading"
            @input="handleAngleInput(joint.name, Number(($event.target as HTMLInputElement).value))"
            @change="handleSendCommand"
          />
          <span class="joint-value">
            目标 {{ joint.target.toFixed(2) }} rad / 当前 {{ joint.current.toFixed(2) }} rad
          </span>
        </label>
      </div>
      <div class="panel-actions">
        <button type="button" :disabled="isConnected || isLoading" @click="connect">连接后端</button>
        <button type="button" :disabled="!isConnected || isLoading" @click="reset">重置仿真</button>
        <button type="button" @click="viewerRef?.resetCamera()">重置视角</button>
      </div>
    </aside>
  </main>
</template>
