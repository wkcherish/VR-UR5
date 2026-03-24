<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import type { XRControllerState, WebXRManager } from '@/utils/xr/WebXRManager'

const props = defineProps<{
  manager: WebXRManager | null
}>()

const emit = defineEmits<{
  controllerFrame: [payload: { active: boolean; controllers: XRControllerState[] }]
}>()

const isSupported = ref({ ar: false, vr: false })
const checkingSupport = ref(false)
const isSessionActive = ref(false)
const statusMessage = ref('')
const controllers = ref<XRControllerState[]>([])

let frameTimer: number | null = null
let stopSessionListener: (() => void) | null = null

const activeControllers = computed(() => controllers.value.filter((controller) => controller.connected))

const stopFrameLoop = () => {
  if (frameTimer !== null) {
    window.clearInterval(frameTimer)
    frameTimer = null
  }
}

const startFrameLoop = () => {
  stopFrameLoop()
  frameTimer = window.setInterval(() => {
    const next = props.manager?.getControllerStates() ?? []
    controllers.value = next
    emit('controllerFrame', { active: isSessionActive.value, controllers: next })
  }, 40)
}

const bindSessionListener = () => {
  stopSessionListener?.()
  stopSessionListener = props.manager?.onSessionChange((active) => {
    isSessionActive.value = active
    statusMessage.value = active ? 'AR 会话进行中' : 'AR 会话已结束'
  }) ?? null
}

const checkSupport = async () => {
  if (!props.manager) {
    isSupported.value = { ar: false, vr: false }
    return
  }
  checkingSupport.value = true
  try {
    isSupported.value = await props.manager.checkSupport()
    statusMessage.value = isSupported.value.ar ? '检测到 immersive-ar 支持' : '当前设备不支持 immersive-ar'
  } catch (error) {
    isSupported.value = { ar: false, vr: false }
    statusMessage.value = error instanceof Error ? error.message : 'WebXR 支持检测失败'
  } finally {
    checkingSupport.value = false
  }
}

const enterAR = async () => {
  if (!props.manager) {
    return
  }
  try {
    await props.manager.startSession('immersive-ar')
    isSessionActive.value = true
    statusMessage.value = '已进入 AR 模式'
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : '进入 AR 模式失败'
  }
}

const exitAR = async () => {
  if (!props.manager) {
    return
  }
  try {
    await props.manager.endSession()
    isSessionActive.value = false
    statusMessage.value = '已退出 AR 模式'
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : '退出 AR 模式失败'
  }
}

watch(
  () => props.manager,
  async (manager) => {
    stopFrameLoop()
    bindSessionListener()
    controllers.value = []
    isSessionActive.value = manager?.isSessionActive() ?? false
    await checkSupport()
    if (manager) {
      startFrameLoop()
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  stopFrameLoop()
  stopSessionListener?.()
  stopSessionListener = null
})
</script>

<template>
  <section class="ar-panel">
    <h2>AR 控制</h2>
    <p>支持状态：{{ checkingSupport ? '检测中...' : isSupported.ar ? '支持' : '不支持' }}</p>
    <p>会话状态：{{ isSessionActive ? '已进入' : '未进入' }}</p>
    <p v-if="statusMessage" class="ar-status">{{ statusMessage }}</p>
    <div class="ar-actions">
      <button type="button" :disabled="!isSupported.ar || isSessionActive" @click="enterAR">进入 AR 模式</button>
      <button type="button" :disabled="!isSessionActive" @click="exitAR">退出 AR 模式</button>
      <button type="button" :disabled="!manager" @click="checkSupport">重新检测</button>
    </div>
    <div class="ar-controller-list">
      <p>已连接控制器：{{ activeControllers.length }}</p>
      <p
        v-for="controller in activeControllers"
        :key="controller.index"
        class="ar-controller-item"
      >
        {{ controller.handedness }} | axes {{ controller.axes.map((item) => item.toFixed(2)).join(', ') || '--' }} | trigger
        {{ (controller.buttons[0] ?? 0).toFixed(2) }}
      </p>
    </div>
  </section>
</template>
