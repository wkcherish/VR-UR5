<script setup lang="ts">
import { computed } from 'vue'
import type {
  XRActiveInputKind,
  XRControllerState,
  XRInteractionMode,
  XRSessionModeType,
  XRSupportState,
} from '@/utils/xr/WebXRManager'

const props = defineProps<{
  supports: XRSupportState
  checkingSupport: boolean
  isSessionActive: boolean
  sessionMode: XRSessionModeType | null
  inputMode: XRInteractionMode
  activeInput: XRActiveInputKind
  controllers: XRControllerState[]
  statusMessage: string
  controlSummary: string
  directionLabel: string
}>()

const emit = defineEmits<{
  refreshSupport: []
  enterMode: [mode: XRSessionModeType]
  exitSession: []
  updateInputMode: [mode: XRInteractionMode]
}>()

const connectedControllers = computed(() => props.controllers.filter((controller) => controller.connected))

const formatHandedness = (handedness: XRControllerState['handedness']) => {
  if (handedness === 'left') {
    return '左手'
  }
  if (handedness === 'right') {
    return '右手'
  }
  return '未知'
}
</script>

<template>
  <section class="xr-panel">
    <div class="xr-panel__heading">
      <div>
        <h2>XR 控制</h2>
        <p>阶段 4：WebXR 会话、Quest 3 手柄与 VR 交互入口</p>
      </div>
      <button type="button" class="xr-link-button" :disabled="checkingSupport" @click="emit('refreshSupport')">
        {{ checkingSupport ? '检测中...' : '重新检测' }}
      </button>
    </div>

    <div class="xr-status-grid">
      <article class="xr-status-card">
        <span>AR 支持</span>
        <strong>{{ supports.ar ? '可用' : '不可用' }}</strong>
      </article>
      <article class="xr-status-card">
        <span>VR 支持</span>
        <strong>{{ supports.vr ? '可用' : '不可用' }}</strong>
      </article>
      <article class="xr-status-card">
        <span>会话模式</span>
        <strong>{{ sessionMode ?? '未进入' }}</strong>
      </article>
      <article class="xr-status-card">
        <span>当前输入</span>
        <strong>{{ activeInput ?? '未检测' }}</strong>
      </article>
    </div>

    <p v-if="statusMessage" class="xr-message">{{ statusMessage }}</p>

    <div class="xr-mode-actions">
      <button
        type="button"
        :disabled="!supports.ar || isSessionActive"
        @click="emit('enterMode', 'immersive-ar')"
      >
        进入 AR 模式
      </button>
      <button
        type="button"
        :disabled="!supports.vr || isSessionActive"
        class="xr-mode-actions__primary"
        @click="emit('enterMode', 'immersive-vr')"
      >
        进入 VR 模式
      </button>
      <button type="button" :disabled="!isSessionActive" @click="emit('exitSession')">退出 XR</button>
    </div>

    <div class="xr-toggle-group">
      <button
        type="button"
        :class="{ 'is-active': inputMode === 'controller' }"
        @click="emit('updateInputMode', 'controller')"
      >
        手柄模式
      </button>
      <button
        type="button"
        :class="{ 'is-active': inputMode === 'hand' }"
        @click="emit('updateInputMode', 'hand')"
      >
        手势模式
      </button>
    </div>

    <div class="xr-feedback">
      <p>控制提示：{{ controlSummary }}</p>
      <p>方向反馈：{{ directionLabel }}</p>
      <p>已接入控制器：{{ connectedControllers.length }}</p>
    </div>

    <div class="xr-controller-list">
      <article v-for="controller in connectedControllers" :key="controller.index" class="xr-controller-item">
        <header>
          <strong>{{ formatHandedness(controller.handedness) }}</strong>
          <span>{{ controller.hasHandTracking ? '支持手部追踪' : '手柄输入' }}</span>
        </header>
        <p>Axes: {{ controller.axes.map((axis) => axis.toFixed(2)).join(', ') || '--' }}</p>
        <p>Buttons: {{ controller.buttons.map((button) => button.toFixed(2)).join(', ') || '--' }}</p>
      </article>
    </div>
  </section>
</template>

<style scoped>
.xr-panel {
  margin-top: 24px;
  padding: 18px;
  border-radius: 20px;
  background: rgba(15, 23, 42, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.18);
  display: grid;
  gap: 16px;
}

.xr-panel__heading {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.xr-panel__heading h2 {
  margin: 0;
  font-size: 18px;
  color: #f8fafc;
}

.xr-panel__heading p {
  margin: 6px 0 0;
  font-size: 13px;
  color: #94a3b8;
}

.xr-link-button {
  border: none;
  background: transparent;
  color: #7dd3fc;
  cursor: pointer;
  padding: 0;
}

.xr-status-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.xr-status-card {
  padding: 14px;
  border-radius: 16px;
  background: rgba(30, 41, 59, 0.62);
  border: 1px solid rgba(148, 163, 184, 0.14);
}

.xr-status-card span {
  display: block;
  font-size: 12px;
  color: #94a3b8;
}

.xr-status-card strong {
  display: block;
  margin-top: 6px;
  color: #f8fafc;
  font-size: 15px;
}

.xr-message {
  margin: 0;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(34, 197, 94, 0.12);
  color: #bbf7d0;
  font-size: 13px;
}

.xr-mode-actions,
.xr-toggle-group {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.xr-mode-actions button,
.xr-toggle-group button {
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.88);
  color: #e2e8f0;
  padding: 10px 14px;
  cursor: pointer;
}

.xr-mode-actions button:disabled,
.xr-toggle-group button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.xr-mode-actions__primary,
.xr-toggle-group .is-active {
  background: linear-gradient(135deg, #0284c7 0%, #0891b2 100%);
  border-color: transparent;
  color: #f8fafc;
}

.xr-feedback {
  display: grid;
  gap: 6px;
  color: #cbd5e1;
  font-size: 13px;
}

.xr-feedback p {
  margin: 0;
}

.xr-controller-list {
  display: grid;
  gap: 10px;
}

.xr-controller-item {
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.14);
}

.xr-controller-item header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: baseline;
  margin-bottom: 6px;
}

.xr-controller-item strong {
  color: #f8fafc;
}

.xr-controller-item span,
.xr-controller-item p {
  color: #cbd5e1;
  font-size: 12px;
  margin: 0;
}

@media (max-width: 640px) {
  .xr-panel__heading,
  .xr-status-grid {
    grid-template-columns: 1fr;
  }
}
</style>
