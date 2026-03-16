<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import RobotViewer from './components/RobotViewer.vue'

type JointName =
  | 'shoulder_pan_joint'
  | 'shoulder_lift_joint'
  | 'elbow_joint'
  | 'wrist_1_joint'
  | 'wrist_2_joint'
  | 'wrist_3_joint'

const viewerRef = ref<InstanceType<typeof RobotViewer> | null>(null)

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
</script>

<template>
  <main class="app-layout">
    <section class="viewer-panel">
      <RobotViewer ref="viewerRef" />
    </section>
    <aside class="control-panel">
      <h1>UR5 3D 可视化</h1>
      <p class="panel-subtitle">阶段 2：场景管理、URDF 解析、关节联动</p>
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
        <button type="button" @click="viewerRef?.resetCamera()">重置视角</button>
      </div>
    </aside>
  </main>
</template>
