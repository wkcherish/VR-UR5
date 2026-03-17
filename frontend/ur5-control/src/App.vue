<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import RobotViewer from './components/RobotViewer.vue'

type JointName =
  | 'shoulder_pan_joint'
  | 'shoulder_lift_joint'
  | 'elbow_joint'
  | 'wrist_1_joint'
  | 'wrist_2_joint'
  | 'wrist_3_joint'

const viewerRef = ref<InstanceType<typeof RobotViewer> | null>(null)
const isPoseTesting = ref(false)
let poseTimer: number | null = null

const joints = reactive<Record<JointName, number>>({
  shoulder_pan_joint: 0,
  shoulder_lift_joint: -1.57,
  elbow_joint: 1.57,
  wrist_1_joint: 0,
  wrist_2_joint: 0,
  wrist_3_joint: 0,
})

const jointList = computed(
  () =>
    Object.entries(joints) as Array<[JointName, number]>,
)

const applyCurrentJoints = () => {
  viewerRef.value?.updateJoints({ ...joints })
}

watch(
  joints,
  applyCurrentJoints,
  { deep: true },
)

watch(viewerRef, applyCurrentJoints)

const resetJoints = () => {
  for (const key of Object.keys(joints) as JointName[]) {
    joints[key] = 0
  }
}

const poseSequence: Array<Record<JointName, number>> = [
  {
    shoulder_pan_joint: 0,
    shoulder_lift_joint: -1.57,
    elbow_joint: 1.57,
    wrist_1_joint: 0,
    wrist_2_joint: 0,
    wrist_3_joint: 0,
  },
  {
    shoulder_pan_joint: 0.8,
    shoulder_lift_joint: -1.2,
    elbow_joint: 0.9,
    wrist_1_joint: -0.7,
    wrist_2_joint: 0.5,
    wrist_3_joint: -0.9,
  },
  {
    shoulder_pan_joint: -1.3,
    shoulder_lift_joint: 0.8,
    elbow_joint: -1.2,
    wrist_1_joint: 1.5,
    wrist_2_joint: -1.1,
    wrist_3_joint: 0.4,
  },
]

const stopPoseTest = () => {
  if (poseTimer !== null) {
    window.clearInterval(poseTimer)
    poseTimer = null
  }
  isPoseTesting.value = false
}

const startPoseTest = () => {
  let index = 0
  isPoseTesting.value = true
  for (const jointName of Object.keys(joints) as JointName[]) {
    joints[jointName] = poseSequence[0][jointName]
  }
  poseTimer = window.setInterval(() => {
    index = (index + 1) % poseSequence.length
    for (const jointName of Object.keys(joints) as JointName[]) {
      joints[jointName] = poseSequence[index][jointName]
    }
  }, 1200)
}

const togglePoseTest = () => {
  if (isPoseTesting.value) {
    stopPoseTest()
    return
  }
  startPoseTest()
}

onUnmounted(() => {
  stopPoseTest()
})
</script>

<template>
  <main class="app-layout">
    <section class="viewer-panel">
      <RobotViewer ref="viewerRef" />
    </section>
    <aside class="control-panel">
      <h1>UR5 3D 可视化</h1>
      <div class="joint-list">
        <label v-for="[name, value] in jointList" :key="name" class="joint-item">
          <span>{{ name }}</span>
          <input
            v-model.number="joints[name]"
            type="range"
            min="-3.1416"
            max="3.1416"
            step="0.01"
          />
          <span class="joint-value">{{ value.toFixed(2) }} rad</span>
        </label>
      </div>
      <div class="panel-actions">
        <button type="button" @click="resetJoints">归零</button>
        <button type="button" @click="togglePoseTest">
          {{ isPoseTesting ? '停止运动测试' : '运行运动测试' }}
        </button>
        <button type="button" @click="viewerRef?.resetCamera()">重置视角</button>
      </div>
    </aside>
  </main>
</template>
