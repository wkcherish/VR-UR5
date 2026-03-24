<script setup lang="ts">
import { computed } from 'vue'
import type {
  XRActiveInputKind,
  XRControllerState,
  XRInteractionMode,
} from '@/utils/xr/WebXRManager'

const props = defineProps<{
  inputMode: XRInteractionMode
  activeInput: XRActiveInputKind
  controllers: XRControllerState[]
  controlSummary: string
  directionLabel: string
  highlightedLabels: string[]
  connectionLabel: string
  jointSummary: string
}>()

const emit = defineEmits<{
  exit: []
  updateInputMode: [mode: XRInteractionMode]
}>()

const connectedControllers = computed(() => props.controllers.filter((controller) => controller.connected))

const formatHandedness = (handedness: XRControllerState['handedness']) => {
  if (handedness === 'left') {
    return '左手柄'
  }
  if (handedness === 'right') {
    return '右手柄'
  }
  return '未知手柄'
}
</script>

<template>
  <div class="vr-overlay">
    <header class="vr-overlay__topbar">
      <div class="vr-overlay__title">
        <span>VR 模式</span>
        <strong>Quest 3 手柄 / 手势交互已启用</strong>
      </div>
      <div class="vr-overlay__actions">
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
        <button type="button" class="vr-overlay__exit" @click="emit('exit')">退出 VR 模式</button>
      </div>
    </header>

    <section class="vr-overlay__hud">
      <article class="vr-overlay__card vr-overlay__card--wide">
        <span>当前输入</span>
        <strong>{{ activeInput ?? '未检测' }}</strong>
        <p>{{ connectionLabel }}</p>
        <p>{{ controlSummary }}</p>
        <p>{{ directionLabel }}</p>
        <p>关节目标：{{ jointSummary }}</p>
        <p>高亮关节：{{ highlightedLabels.join(' / ') || '暂无' }}</p>
      </article>

      <article v-for="controller in connectedControllers" :key="controller.index" class="vr-overlay__card">
        <span>{{ formatHandedness(controller.handedness) }}</span>
        <strong>{{ controller.hasHandTracking ? '手部追踪可用' : '控制器在线' }}</strong>
        <p v-if="controller.handPinch">
          Pinch(I/M/R): {{ controller.handPinch.index.toFixed(2) }} /
          {{ controller.handPinch.middle.toFixed(2) }} /
          {{ controller.handPinch.ring.toFixed(2) }}
        </p>
        <p>Axes: {{ controller.axes.map((axis) => axis.toFixed(2)).join(', ') || '--' }}</p>
        <p>Buttons: {{ controller.buttons.map((button) => button.toFixed(2)).join(', ') || '--' }}</p>
      </article>
    </section>
  </div>
</template>

<style scoped>
.vr-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 18px;
  z-index: 10;
}

.vr-overlay__topbar {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  padding: 14px 18px;
  border-radius: 18px;
  background: rgba(8, 15, 33, 0.7);
  border: 1px solid rgba(125, 211, 252, 0.22);
  backdrop-filter: blur(16px);
  pointer-events: auto;
}

.vr-overlay__title {
  display: grid;
  gap: 4px;
}

.vr-overlay__title span {
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #7dd3fc;
}

.vr-overlay__title strong {
  color: #f8fafc;
  font-size: 18px;
}

.vr-overlay__actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.vr-overlay__actions button {
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.82);
  color: #e2e8f0;
  padding: 10px 14px;
  cursor: pointer;
}

.vr-overlay__actions .is-active {
  background: linear-gradient(135deg, #0284c7 0%, #0f766e 100%);
  border-color: transparent;
}

.vr-overlay__exit {
  background: linear-gradient(135deg, #ef4444 0%, #f97316 100%);
  border-color: transparent;
  color: #fff7ed;
}

.vr-overlay__hud {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  align-items: end;
}

.vr-overlay__card {
  min-height: 132px;
  padding: 16px;
  border-radius: 18px;
  background: rgba(8, 15, 33, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.18);
  backdrop-filter: blur(18px);
  color: #e2e8f0;
}

.vr-overlay__card--wide {
  grid-column: span 1;
}

.vr-overlay__card span {
  display: block;
  font-size: 12px;
  color: #7dd3fc;
  margin-bottom: 8px;
}

.vr-overlay__card strong {
  display: block;
  color: #f8fafc;
  margin-bottom: 8px;
}

.vr-overlay__card p {
  margin: 4px 0 0;
  font-size: 12px;
  color: #cbd5e1;
}

@media (max-width: 960px) {
  .vr-overlay__topbar,
  .vr-overlay__hud {
    grid-template-columns: 1fr;
  }

  .vr-overlay__topbar {
    display: grid;
  }

  .vr-overlay__hud {
    display: grid;
  }
}
</style>
