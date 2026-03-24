<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import RobotViewer from './components/RobotViewer.vue'
import VRSessionOverlay from './components/VRSessionOverlay.vue'
import { useRobot } from '@/composables/useRobot'
import { JOINT_LIMITS, JOINT_ORDER } from '@/types/robot'
import type { JointName } from '@/types/robot'
import type { SceneManager } from '@/utils/scene/SceneManager'
import {
  WebXRManager,
  type XRActiveInputKind,
  type XRControllerState,
  type XRInteractionMode,
  type XRSessionModeType,
} from '@/utils/xr/WebXRManager'
import { createXRControlSmoothingState, resolveXRControllerCommand } from '@/utils/xr/xrControl'

const viewerRef = ref<InstanceType<typeof RobotViewer> | null>(null)
const {
  connect,
  sendCommand,
  reset,
  setTargetAngle,
  setTargetGripperPosition,
  markLocalControlActivity,
  isConnected,
  isLoading,
  isLocalControlling,
  shouldHoldLocalPose,
  error,
  currentState,
  targetAngles,
  targetGripperPosition,
  lastUpdatedAt,
} = useRobot({ pollingInterval: 50 })

const GRIPPER_MIN = 0
const GRIPPER_MAX = 0.9
const GRIPPER_STEP = 0.01
const XR_COMMAND_INTERVAL_MS = 55
const GRIPPER_JOINT_NAMES = [
  'left_driver_joint',
  'right_driver_joint',
  'left_spring_link_joint',
  'right_spring_link_joint',
  'left_follower_joint',
  'right_follower_joint',
] as const

const JOINT_LABELS: Record<JointName, string> = {
  shoulder_pan_joint: 'Shoulder Pan',
  shoulder_lift_joint: 'Shoulder Lift',
  elbow_joint: 'Elbow',
  wrist_1_joint: 'Wrist 1',
  wrist_2_joint: 'Wrist 2',
  wrist_3_joint: 'Wrist 3',
}

const jointList = computed(() =>
  JOINT_ORDER.map((jointName) => ({
    name: jointName,
    limit: JOINT_LIMITS[jointName],
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

const gripperCurrent = computed(() => {
  const value = currentState.value?.gripper_position
  if (value === null || value === undefined) {
    return targetGripperPosition.value
  }
  return value
})

const handleSendCommand = async (angles?: Partial<Record<JointName, number>>, gripperPosition?: number) => {
  if (!isConnected.value) {
    return
  }
  await sendCommand(angles, gripperPosition)
}

const appendGripperJoints = (jointAngles: Record<string, number>, gripperPosition: number) => {
  for (const jointName of GRIPPER_JOINT_NAMES) {
    jointAngles[jointName] = gripperPosition
  }
}

const previewViewerFromTargets = () => {
  const nextAngles: Record<string, number> = {}
  for (const jointName of JOINT_ORDER) {
    nextAngles[jointName] = targetAngles.value[jointName]
  }
  appendGripperJoints(nextAngles, targetGripperPosition.value)
  viewerRef.value?.updateJoints(nextAngles)
}

const handleAngleInput = (jointName: JointName, value: number) => {
  markLocalControlActivity()
  setTargetAngle(jointName, value)
  previewViewerFromTargets()
  void handleSendCommand({ [jointName]: targetAngles.value[jointName] })
}

const handleGripperInput = (value: number) => {
  markLocalControlActivity()
  setTargetGripperPosition(value)
  previewViewerFromTargets()
  void handleSendCommand(undefined, targetGripperPosition.value)
}

watch(
  () => [currentState.value?.joints, currentState.value?.gripper_position] as const,
  ([joints, gripperPosition]) => {
    if (shouldHoldLocalPose.value || isLocalControlling.value) {
      return
    }
    if (!joints?.length && (gripperPosition === null || gripperPosition === undefined)) {
      return
    }
    const nextAngles: Record<string, number> = {}
    for (const joint of joints ?? []) {
      nextAngles[joint.joint_name] = joint.position
    }
    appendGripperJoints(nextAngles, gripperPosition ?? targetGripperPosition.value)
    viewerRef.value?.updateJoints(nextAngles)
  },
  { immediate: true, deep: true },
)

const xrManager = ref<WebXRManager | null>(null)
const xrSessionMode = ref<XRSessionModeType | null>(null)
const xrInputMode = ref<XRInteractionMode>('controller')
const xrActiveInput = ref<XRActiveInputKind>('none')
const xrControllers = ref<XRControllerState[]>([])
const xrStatusMessage = ref('等待 3D 场景初始化')
const xrControlSummary = ref('按住左手 Grip / Y / X 选择关节组')
const xrDirectionLabel = ref('摇杆静止')
const xrHighlightedJoints = ref<JointName[]>([])

let stopXRSessionListener: (() => void) | null = null
let stopXRInputListener: (() => void) | null = null
let lastXRCommandAt = 0
let xrCommandInFlight = false
const xrSmoothingState = createXRControlSmoothingState(targetGripperPosition.value)

const isXRSessionActive = computed(() => xrSessionMode.value !== null)
const highlightedJointSet = computed(() => new Set(xrHighlightedJoints.value))
const highlightedJointLabels = computed(() => xrHighlightedJoints.value.map((jointName) => JOINT_LABELS[jointName]))
const xrConnectionLabel = computed(() => `机器人连接：${isConnected.value ? '已连接' : '未连接'}`)
const xrJointSummary = computed(() =>
  JOINT_ORDER.map((jointName) => `${JOINT_LABELS[jointName]} ${targetAngles.value[jointName].toFixed(2)}`).join(' | '),
)

const resetXRFeedback = () => {
  xrControlSummary.value = '按住左手 Grip / Y / X 选择关节组'
  xrDirectionLabel.value = '摇杆静止'
  xrHighlightedJoints.value = []
}

const refreshXRSupport = async () => {
  const manager = xrManager.value
  if (!manager) {
    xrStatusMessage.value = '等待 3D 场景初始化'
    return
  }
  try {
    const support = await manager.checkSupport()
    const supports: string[] = []
    if (support.ar) {
      supports.push('AR')
    }
    if (support.vr) {
      supports.push('VR')
    }
    xrStatusMessage.value = supports.length > 0
      ? `检测到 ${supports.join(' / ')} 支持`
      : '当前设备不支持 immersive-ar / immersive-vr'
  } catch (nextError) {
    xrStatusMessage.value = nextError instanceof Error ? nextError.message : 'XR 支持检测失败'
  }
}

const updateXRInputMode = (mode: XRInteractionMode) => {
  xrInputMode.value = mode
  xrManager.value?.setInputMode(mode)
  resetXRFeedback()
}

const enterXRMode = async (mode: XRSessionModeType) => {
  const manager = xrManager.value
  if (!manager) {
    xrStatusMessage.value = '3D 场景尚未完成初始化'
    return
  }
  if (mode === 'immersive-vr' && !window.isSecureContext) {
    xrStatusMessage.value = '当前不是安全上下文。Quest 3 进入VR需要 HTTPS（或 localhost）。'
    return
  }
  try {
    await manager.startSession(mode)
    xrSessionMode.value = manager.getSessionMode()
    xrStatusMessage.value = `已进入 ${mode} 会话`
    lastXRCommandAt = 0
  } catch (nextError) {
    xrStatusMessage.value = nextError instanceof Error ? nextError.message : '进入 XR 会话失败'
  }
}

const exitXRSession = async () => {
  const manager = xrManager.value
  if (!manager) {
    return
  }
  try {
    await manager.endSession()
    xrSessionMode.value = null
    xrStatusMessage.value = 'XR 会话已退出'
    resetXRFeedback()
    xrControllers.value = []
  } catch (nextError) {
    xrStatusMessage.value = nextError instanceof Error ? nextError.message : '退出 XR 会话失败'
  }
}

const updateXRHud = () => {
  xrManager.value?.setHudState({
    statusMessage: xrStatusMessage.value,
    connectionState: xrConnectionLabel.value,
    controlSummary: xrControlSummary.value,
    directionLabel: xrDirectionLabel.value,
    jointAnglesText: xrJointSummary.value,
  })
}

const handleXRFrame = () => {
  const manager = xrManager.value
  if (!manager) {
    return
  }

  manager.updateFrame()
  xrControllers.value = manager.getControllerStates()
  xrActiveInput.value = manager.getActiveInput()

  if (!manager.isSessionActive()) {
    xrSessionMode.value = null
    updateXRHud()
    return
  }

  xrSessionMode.value = manager.getSessionMode()

  if (xrInputMode.value !== 'controller') {
    xrControlSummary.value = '手势模式中，手柄映射已暂停'
    xrDirectionLabel.value = '由手势输入驱动'
    xrHighlightedJoints.value = []
    updateXRHud()
    return
  }

  const feedback = resolveXRControllerCommand(
    xrControllers.value,
    targetAngles.value,
    targetGripperPosition.value,
    xrSmoothingState,
  )
  xrControlSummary.value = feedback.summary
  xrDirectionLabel.value = feedback.directionLabel
  xrHighlightedJoints.value = feedback.highlightedJoints
  updateXRHud()

  if (!feedback.hasCommand || !isConnected.value || xrCommandInFlight) {
    return
  }

  const now = performance.now()
  if (now - lastXRCommandAt < XR_COMMAND_INTERVAL_MS) {
    return
  }

  const hasJointUpdate = Object.keys(feedback.updates).length > 0
  const hasGripperUpdate = Math.abs(feedback.gripperPosition - targetGripperPosition.value) > 0.004
  if (!hasJointUpdate && !hasGripperUpdate) {
    return
  }

  markLocalControlActivity()
  for (const [jointName, angle] of Object.entries(feedback.updates)) {
    setTargetAngle(jointName as JointName, angle as number)
  }
  if (hasGripperUpdate) {
    setTargetGripperPosition(feedback.gripperPosition)
  }
  previewViewerFromTargets()

  xrCommandInFlight = true
  lastXRCommandAt = now
  void handleSendCommand(
    hasJointUpdate ? feedback.updates as Partial<Record<JointName, number>> : undefined,
    feedback.gripperPosition,
  )
    .catch((nextError) => {
      xrStatusMessage.value = nextError instanceof Error ? nextError.message : 'XR 控制发送失败'
    })
    .finally(() => {
      xrCommandInFlight = false
    })
}

const clearXRListeners = () => {
  stopXRSessionListener?.()
  stopXRSessionListener = null
  stopXRInputListener?.()
  stopXRInputListener = null
}

const bindXRManager = (sceneManager: SceneManager) => {
  clearXRListeners()
  xrManager.value?.dispose()

  const manager = new WebXRManager(sceneManager.renderer, sceneManager.scene, sceneManager.camera)
  xrManager.value = manager
  manager.setInputMode(xrInputMode.value)

  stopXRSessionListener = manager.onSessionChange((active) => {
    xrSessionMode.value = active ? manager.getSessionMode() : null
    xrStatusMessage.value = active
      ? `XR 会话进行中 (${manager.getSessionMode() ?? 'unknown'})`
      : 'XR 会话已结束'
    if (!active) {
      resetXRFeedback()
      xrControllers.value = []
    }
  })

  stopXRInputListener = manager.onActiveInputChange((activeInput) => {
    xrActiveInput.value = activeInput
  })

  sceneManager.setRenderHook(handleXRFrame)
  void refreshXRSupport()
}

const handleViewerReady = (sceneManager: SceneManager) => {
  bindXRManager(sceneManager)
}

const isVrImmersiveActive = computed(() => isXRSessionActive.value && xrSessionMode.value === 'immersive-vr')

watch(
  () => targetGripperPosition.value,
  (nextGripperPosition) => {
    if (!isXRSessionActive.value) {
      xrSmoothingState.gripper = nextGripperPosition
    }
  },
)

onMounted(async () => {
  if (!isConnected.value) {
    await connect()
  }
})

onUnmounted(() => {
  viewerRef.value?.setRenderHook(null)
  clearXRListeners()
  const manager = xrManager.value
  xrManager.value = null
  manager?.dispose()
})
</script>

<template>
  <main class="app-layout" :class="{ 'is-vr-active': isVrImmersiveActive }">
    <section class="viewer-panel">
      <RobotViewer ref="viewerRef" @ready="handleViewerReady" />
      <VRSessionOverlay
        v-if="isXRSessionActive && xrSessionMode === 'immersive-vr'"
        :input-mode="xrInputMode"
        :active-input="xrActiveInput"
        :controllers="xrControllers"
        :control-summary="xrControlSummary"
        :direction-label="xrDirectionLabel"
        :highlighted-labels="highlightedJointLabels"
        :connection-label="xrConnectionLabel"
        :joint-summary="xrJointSummary"
        @exit="exitXRSession"
        @update-input-mode="updateXRInputMode"
      />
    </section>
    <aside v-if="!isVrImmersiveActive" class="control-panel">
      <h1>UR5 3D 可视化</h1>
      <p>连接状态：{{ isConnected ? '已连接' : '未连接' }}</p>
      <p>最后更新：{{ lastUpdatedLabel }}</p>
      <div class="xr-quick">
        <p class="xr-quick__status">XR 会话：{{ xrSessionMode ?? '未进入' }}</p>
        <div class="xr-quick__actions">
          <button
            type="button"
            :disabled="!xrManager || (isXRSessionActive && xrSessionMode === 'immersive-vr')"
            @click="enterXRMode('immersive-vr')"
          >
            进入VR模式
          </button>
          <button type="button" :disabled="!isXRSessionActive" @click="exitXRSession">退出VR模式</button>
        </div>
        <p v-if="xrStatusMessage" class="xr-quick__hint">{{ xrStatusMessage }}</p>
      </div>
      <p v-if="error" class="error-text">{{ error }}</p>
      <div class="joint-list">
        <label
          v-for="joint in jointList"
          :key="joint.name"
          class="joint-item"
          :class="{ 'is-highlighted': highlightedJointSet.has(joint.name) }"
        >
          <span>{{ joint.name }}</span>
          <input
            :value="joint.target"
            type="range"
            :min="joint.limit.lower"
            :max="joint.limit.upper"
            step="0.01"
            :disabled="!isConnected || isLoading"
            @input="handleAngleInput(joint.name, Number(($event.target as HTMLInputElement).value))"
          />
          <span class="joint-value">
            目标 {{ joint.target.toFixed(2) }} rad / 当前 {{ joint.current.toFixed(2) }} rad
          </span>
        </label>
        <label class="joint-item">
          <span>gripper_joint</span>
          <input
            :value="targetGripperPosition"
            type="range"
            :min="GRIPPER_MIN"
            :max="GRIPPER_MAX"
            :step="GRIPPER_STEP"
            :disabled="!isConnected || isLoading"
            @input="handleGripperInput(Number(($event.target as HTMLInputElement).value))"
          />
          <span class="joint-value">
            目标 {{ targetGripperPosition.toFixed(2) }} rad / 当前 {{ gripperCurrent.toFixed(2) }} rad
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
