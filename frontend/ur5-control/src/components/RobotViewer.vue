<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { SceneManager } from '../utils/scene/SceneManager'
import { loadRobotFromUrdf, updateRobotJoints } from '../utils/urdf/robotLoader'
import type { RobotModel } from '../utils/urdf/robotLoader'

interface RobotViewerExpose {
  updateJoints: (targetAngles: Record<string, number>) => void
  resetCamera: () => void
}

const props = withDefaults(
  defineProps<{
    urdfUrl?: string
    useCollisionMesh?: boolean
  }>(),
  {
    urdfUrl: '/models/ur5.urdf',
    useCollisionMesh: false,
  },
)

const containerRef = ref<HTMLElement | null>(null)
const loading = ref(true)
const error = ref('')

let sceneManager: SceneManager | null = null
let robotModel: RobotModel | null = null
let robotRoot: THREE.Group | null = null

const updateJoints = (targetAngles: Record<string, number>) => {
  if (!robotModel) {
    return
  }
  updateRobotJoints(robotModel, targetAngles)
}

const resetCamera = () => {
  if (!sceneManager) {
    return
  }
  sceneManager.camera.position.set(3, 2, 3)
  sceneManager.controls.target.set(0, 0.6, 0)
  sceneManager.controls.update()
}

const handleResize = () => {
  sceneManager?.resize()
}

const initRobot = async () => {
  if (!sceneManager) {
    return
  }
  if (robotRoot) {
    sceneManager.scene.remove(robotRoot)
    robotRoot = null
    robotModel = null
  }
  loading.value = true
  error.value = ''

  try {
    robotModel = await loadRobotFromUrdf(props.urdfUrl, props.useCollisionMesh)
    robotRoot = robotModel.root
    sceneManager.scene.add(robotRoot)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '机器人加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (!containerRef.value) {
    return
  }
  sceneManager = new SceneManager(containerRef.value)
  sceneManager.start()
  window.addEventListener('resize', handleResize)
  await initRobot()
})

watch(
  () => [props.urdfUrl, props.useCollisionMesh],
  async () => {
    await initRobot()
  },
)

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  if (sceneManager && robotRoot) {
    sceneManager.scene.remove(robotRoot)
  }
  sceneManager?.dispose()
  sceneManager = null
  robotModel = null
  robotRoot = null
})

defineExpose<RobotViewerExpose>({
  updateJoints,
  resetCamera,
})
</script>

<template>
  <div class="viewer">
    <div ref="containerRef" class="viewer-canvas"></div>
    <div v-if="loading" class="viewer-state">正在加载 UR5 模型...</div>
    <div v-else-if="error" class="viewer-error">{{ error }}</div>
  </div>
</template>

<style scoped>
.viewer {
  position: relative;
  width: 100%;
  height: 100%;
}

.viewer-canvas {
  width: 100%;
  height: 100%;
  min-height: 520px;
}

.viewer-state {
  position: absolute;
  left: 16px;
  top: 16px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.8);
  color: #e2e8f0;
  font-size: 14px;
}

.viewer-error {
  position: absolute;
  left: 16px;
  top: 16px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(127, 29, 29, 0.95);
  color: #fee2e2;
  font-size: 14px;
}
</style>
