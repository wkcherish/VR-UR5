import { clampJointAngle } from '@/types/robot'
import type { JointAngles, JointName } from '@/types/robot'
import type { XRControllerState } from '@/utils/xr/WebXRManager'

export interface XRControlFeedback {
  updates: Partial<JointAngles>
  highlightedJoints: JointName[]
  summary: string
  directionLabel: string
  gripperPosition: number
  hasCommand: boolean
}

export interface XRControlSmoothingState {
  stickX: number
  stickY: number
  gripper: number
}

export interface XRHandControlState {
  moveX: number
  moveY: number
  previousRightX: number | null
  previousRightY: number | null
  isDragging: boolean
  dragReleaseAt: number | null
  lastTrackedAt: number
  gripper: number
  activeGroup: XRHandControlGroup | null
}

export interface XRControlOptions {
  deadzone?: number
  jointStep?: number
  precisionScale?: number
  stickSmoothing?: number
  gripperSmoothing?: number
  gripperMin?: number
  gripperMax?: number
}

export interface XRHandControlOptions {
  movementDeadzone?: number
  movementGain?: number
  maxFrameMovement?: number
  movementSmoothing?: number
  movePinchEngageThreshold?: number
  movePinchReleaseThreshold?: number
  dragHoldMs?: number
  trackingGraceMs?: number
  precisionScale?: number
  groupPinchThreshold?: number
  precisionPinchThreshold?: number
  gripperPinchThreshold?: number
  gripperSmoothing?: number
  gripperMin?: number
  gripperMax?: number
}

type XRHandControlGroup = 'shoulder' | 'forearm' | 'wrist'

const DEFAULT_OPTIONS: Required<XRControlOptions> = {
  deadzone: 0.1,
  jointStep: 0.07,
  precisionScale: 0.4,
  stickSmoothing: 0.25,
  gripperSmoothing: 0.16,
  gripperMin: 0,
  gripperMax: 0.9,
}

const DEFAULT_HAND_OPTIONS: Required<XRHandControlOptions> = {
  movementDeadzone: 0.0026,
  movementGain: 3.2,
  maxFrameMovement: 0.022,
  movementSmoothing: 0.32,
  movePinchEngageThreshold: 0.52,
  movePinchReleaseThreshold: 0.28,
  dragHoldMs: 180,
  trackingGraceMs: 280,
  precisionScale: 0.42,
  groupPinchThreshold: 0.62,
  precisionPinchThreshold: 0.62,
  gripperPinchThreshold: 0.2,
  gripperSmoothing: 0.2,
  gripperMin: 0,
  gripperMax: 0.9,
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const getControllerByHandedness = (controllers: XRControllerState[], handedness: XRHandedness) =>
  controllers.find((controller) => controller.connected && controller.handedness === handedness)

const getTrackedHandByHandedness = (controllers: XRControllerState[], handedness: XRHandedness) =>
  controllers.find((controller) =>
    controller.connected
    && controller.handedness === handedness
    && controller.hasHandTracking
    && controller.handPinch !== null,
  )

const getStickAxis = (axes: number[], axisIndex: number, fallbackIndex: number) => {
  if (axes.length > axisIndex) {
    return axes[axisIndex]
  }
  if (axes.length > fallbackIndex) {
    return axes[fallbackIndex]
  }
  return 0
}

const applyDeadzone = (value: number, deadzone: number) => {
  const magnitude = Math.abs(value)
  if (magnitude <= deadzone) {
    return 0
  }
  const normalized = (magnitude - deadzone) / (1 - deadzone)
  return Math.sign(value) * normalized
}

const applyLinearDeadzone = (value: number, deadzone: number) => {
  const magnitude = Math.abs(value)
  if (magnitude <= deadzone) {
    return 0
  }
  return Math.sign(value) * (magnitude - deadzone)
}

const lowPass = (previous: number, next: number, alpha: number) => previous + (next - previous) * clamp(alpha, 0, 1)

const isPressed = (buttons: number[], index: number) => (buttons[index] ?? 0) > 0.5

const getDirectionLabel = (stickX: number, stickY: number) => {
  if (Math.abs(stickX) < 1e-3 && Math.abs(stickY) < 1e-3) {
    return '摇杆静止'
  }
  if (Math.abs(stickX) >= Math.abs(stickY)) {
    return stickX > 0 ? '右 ->' : '左 <-'
  }
  return stickY > 0 ? '下 v' : '上 ^'
}

const getHandDirectionLabel = (moveX: number, moveY: number) => {
  if (Math.abs(moveX) < 1e-4 && Math.abs(moveY) < 1e-4) {
    return '手部静止'
  }
  if (Math.abs(moveX) >= Math.abs(moveY)) {
    return moveX > 0 ? '手部向右 ->' : '手部向左 <-'
  }
  return moveY > 0 ? '手部向上 ^' : '手部向下 v'
}

const HAND_GROUP_LABELS: Record<XRHandControlGroup, string> = {
  shoulder: '手势大臂组控制 (Shoulder Pan / Shoulder Lift)',
  forearm: '手势前臂组控制 (Elbow / Wrist 1)',
  wrist: '手势腕部组控制 (Wrist 2 / Wrist 3)',
}

const getRightGrabStrength = (pinch: { index: number; middle: number; ring: number }) =>
  clamp(pinch.index * 0.7 + pinch.middle * 0.2 + pinch.ring * 0.1, 0, 1)

const resolveHandGroup = (
  leftHand: XRControllerState,
  threshold: number,
): XRHandControlGroup | null => {
  const pinches = leftHand.handPinch
  if (!pinches) {
    return null
  }
  const candidates: Array<{ group: XRHandControlGroup; strength: number }> = [
    { group: 'wrist', strength: pinches.index },
    { group: 'forearm', strength: pinches.middle },
    { group: 'shoulder', strength: pinches.ring },
  ]
  let selected: XRHandControlGroup | null = null
  let maxStrength = threshold
  for (const candidate of candidates) {
    if (candidate.strength >= maxStrength) {
      maxStrength = candidate.strength
      selected = candidate.group
    }
  }
  return selected
}

const createUpdates = (
  currentAngles: JointAngles,
  delta: Partial<Record<JointName, number>>,
): Partial<JointAngles> => {
  const updates: Partial<JointAngles> = {}
  for (const [jointName, offset] of Object.entries(delta)) {
    if (offset === undefined || offset === 0) {
      continue
    }
    const typedJointName = jointName as JointName
    updates[typedJointName] = clampJointAngle(typedJointName, currentAngles[typedJointName] + offset)
  }
  return updates
}

export const createXRControlSmoothingState = (initialGripper = 0.8): XRControlSmoothingState => ({
  stickX: 0,
  stickY: 0,
  gripper: initialGripper,
})

export const createXRHandControlState = (initialGripper = 0.8): XRHandControlState => ({
  moveX: 0,
  moveY: 0,
  previousRightX: null,
  previousRightY: null,
  isDragging: false,
  dragReleaseAt: null,
  lastTrackedAt: 0,
  gripper: initialGripper,
  activeGroup: null,
})

export const resolveXRControllerCommand = (
  controllers: XRControllerState[],
  currentAngles: JointAngles,
  currentGripperPosition: number,
  smoothingState: XRControlSmoothingState,
  options?: XRControlOptions,
): XRControlFeedback => {
  const config = { ...DEFAULT_OPTIONS, ...options }
  const leftController = getControllerByHandedness(controllers, 'left')
  const rightController = getControllerByHandedness(controllers, 'right')

  if (!leftController || !rightController) {
    smoothingState.stickX = lowPass(smoothingState.stickX, 0, config.stickSmoothing)
    smoothingState.stickY = lowPass(smoothingState.stickY, 0, config.stickSmoothing)
    smoothingState.gripper = lowPass(smoothingState.gripper, currentGripperPosition, config.gripperSmoothing)
    return {
      updates: {},
      highlightedJoints: [],
      summary: '等待左右手柄连接',
      directionLabel: '未检测到完整输入',
      gripperPosition: clamp(smoothingState.gripper, config.gripperMin, config.gripperMax),
      hasCommand: false,
    }
  }

  const rawStickX = getStickAxis(rightController.axes, 2, 0)
  const rawStickY = getStickAxis(rightController.axes, 3, 1)
  const normalizedStickX = applyDeadzone(rawStickX, config.deadzone)
  const normalizedStickY = applyDeadzone(rawStickY, config.deadzone)
  const smoothStickX = lowPass(smoothingState.stickX, normalizedStickX, config.stickSmoothing)
  const smoothStickY = lowPass(smoothingState.stickY, normalizedStickY, config.stickSmoothing)
  smoothingState.stickX = smoothStickX
  smoothingState.stickY = smoothStickY

  const precisionMode = (leftController.buttons[0] ?? 0) > 0.1
  const speedScale = config.jointStep * (precisionMode ? config.precisionScale : 1)
  const directionLabel = getDirectionLabel(smoothStickX, smoothStickY)

  let highlightedJoints: JointName[] = []
  let summary = precisionMode ? '精细模式已启用' : '等待模式键 (Grip / Y / X)'
  let updates: Partial<JointAngles> = {}

  if (isPressed(leftController.buttons, 1)) {
    highlightedJoints = ['wrist_2_joint', 'wrist_3_joint']
    summary = precisionMode
      ? 'Grip 手腕组控制 (精细模式)'
      : 'Grip 手腕组控制 (Wrist 2 / Wrist 3)'
    updates = createUpdates(currentAngles, {
      wrist_2_joint: smoothStickY * speedScale,
      wrist_3_joint: smoothStickX * speedScale,
    })
  } else if (isPressed(leftController.buttons, 5)) {
    highlightedJoints = ['elbow_joint', 'wrist_1_joint']
    summary = precisionMode
      ? 'Y 前臂组控制 (精细模式)'
      : 'Y 前臂组控制 (Elbow / Wrist 1)'
    updates = createUpdates(currentAngles, {
      elbow_joint: smoothStickY * speedScale,
      wrist_1_joint: smoothStickX * speedScale,
    })
  } else if (isPressed(leftController.buttons, 4)) {
    highlightedJoints = ['shoulder_pan_joint', 'shoulder_lift_joint']
    summary = precisionMode
      ? 'X 大臂组控制 (精细模式)'
      : 'X 大臂组控制 (Shoulder Pan / Shoulder Lift)'
    updates = createUpdates(currentAngles, {
      shoulder_pan_joint: smoothStickY * speedScale,
      shoulder_lift_joint: smoothStickX * speedScale,
    })
  }

  const triggerValue = clamp(rightController.buttons[0] ?? 0, 0, 1)
  const mappedGripper = config.gripperMin + triggerValue * (config.gripperMax - config.gripperMin)
  smoothingState.gripper = lowPass(smoothingState.gripper, mappedGripper, config.gripperSmoothing)
  const gripperPosition = clamp(smoothingState.gripper, config.gripperMin, config.gripperMax)

  const hasJointUpdate = Object.keys(updates).length > 0
  const hasGripperUpdate = Math.abs(gripperPosition - currentGripperPosition) > 0.004

  return {
    updates,
    highlightedJoints,
    summary,
    directionLabel,
    gripperPosition,
    hasCommand: hasJointUpdate || hasGripperUpdate,
  }
}

export const resolveXRHandCommand = (
  controllers: XRControllerState[],
  currentAngles: JointAngles,
  currentGripperPosition: number,
  handState: XRHandControlState,
  options?: XRHandControlOptions,
): XRControlFeedback => {
  const config = { ...DEFAULT_HAND_OPTIONS, ...options }
  const now = performance.now()
  const leftHand = getTrackedHandByHandedness(controllers, 'left')
  const rightHand = getTrackedHandByHandedness(controllers, 'right')

  if (!leftHand || !rightHand || !leftHand.handPinch || !rightHand.handPinch) {
    const recentlyTracked = handState.lastTrackedAt > 0 && now - handState.lastTrackedAt <= config.trackingGraceMs
    handState.moveX = lowPass(handState.moveX, 0, config.movementSmoothing)
    handState.moveY = lowPass(handState.moveY, 0, config.movementSmoothing)
    if (!recentlyTracked) {
      handState.isDragging = false
      handState.dragReleaseAt = null
      handState.previousRightX = null
      handState.previousRightY = null
    }
    handState.gripper = lowPass(handState.gripper, currentGripperPosition, config.gripperSmoothing)
    return {
      updates: {},
      highlightedJoints: [],
      summary: recentlyTracked ? '手部追踪短暂丢失，保持当前控制' : '等待双手手部追踪',
      directionLabel: recentlyTracked ? '请保持手部在视野内' : '未检测到完整手势输入',
      gripperPosition: clamp(handState.gripper, config.gripperMin, config.gripperMax),
      hasCommand: false,
    }
  }
  handState.lastTrackedAt = now

  const selectedGroup = resolveHandGroup(leftHand, config.groupPinchThreshold)
  if (selectedGroup) {
    handState.activeGroup = selectedGroup
  }

  const rightGrabStrength = getRightGrabStrength(rightHand.handPinch)
  if (!handState.isDragging && rightGrabStrength >= config.movePinchEngageThreshold) {
    handState.isDragging = true
    handState.dragReleaseAt = null
    handState.previousRightX = rightHand.position.x
    handState.previousRightY = rightHand.position.y
  } else if (handState.isDragging) {
    if (rightGrabStrength <= config.movePinchReleaseThreshold) {
      if (handState.dragReleaseAt === null) {
        handState.dragReleaseAt = now
      } else if (now - handState.dragReleaseAt >= config.dragHoldMs) {
        handState.isDragging = false
        handState.dragReleaseAt = null
        handState.previousRightX = null
        handState.previousRightY = null
      }
    } else {
      handState.dragReleaseAt = null
    }
  }

  let rawMoveX = 0
  let rawMoveY = 0
  if (
    handState.isDragging
    && handState.previousRightX !== null
    && handState.previousRightY !== null
  ) {
    rawMoveX = rightHand.position.x - handState.previousRightX
    rawMoveY = rightHand.position.y - handState.previousRightY
    handState.previousRightX = rightHand.position.x
    handState.previousRightY = rightHand.position.y
  } else {
    handState.previousRightX = null
    handState.previousRightY = null
  }

  rawMoveX = clamp(rawMoveX, -config.maxFrameMovement, config.maxFrameMovement)
  rawMoveY = clamp(rawMoveY, -config.maxFrameMovement, config.maxFrameMovement)

  const filteredMoveX = applyLinearDeadzone(rawMoveX, config.movementDeadzone)
  const filteredMoveY = applyLinearDeadzone(rawMoveY, config.movementDeadzone)
  const targetMoveX = handState.isDragging ? filteredMoveX : 0
  const targetMoveY = handState.isDragging ? filteredMoveY : 0
  const smoothMoveX = lowPass(handState.moveX, targetMoveX, config.movementSmoothing)
  const smoothMoveY = lowPass(handState.moveY, targetMoveY, config.movementSmoothing)
  handState.moveX = smoothMoveX
  handState.moveY = smoothMoveY

  const precisionMode = rightHand.handPinch.ring >= config.precisionPinchThreshold
  const speedScale = config.movementGain * (precisionMode ? config.precisionScale : 1)
  const moveX = smoothMoveX * speedScale
  const moveY = smoothMoveY * speedScale
  const directionLabel = handState.isDragging
    ? getHandDirectionLabel(smoothMoveX, smoothMoveY)
    : '右手抓握后移动'

  let highlightedJoints: JointName[] = []
  let summary = '左手捏合食指/中指/无名指选择关节组'
  let updates: Partial<JointAngles> = {}

  if (handState.activeGroup === 'wrist' && handState.isDragging) {
    highlightedJoints = ['wrist_2_joint', 'wrist_3_joint']
    summary = precisionMode
      ? `${HAND_GROUP_LABELS.wrist} (拖拽中 / 精细模式)`
      : `${HAND_GROUP_LABELS.wrist} (拖拽中)`
    updates = createUpdates(currentAngles, {
      wrist_2_joint: moveY,
      wrist_3_joint: moveX,
    })
  } else if (handState.activeGroup === 'forearm' && handState.isDragging) {
    highlightedJoints = ['elbow_joint', 'wrist_1_joint']
    summary = precisionMode
      ? `${HAND_GROUP_LABELS.forearm} (拖拽中 / 精细模式)`
      : `${HAND_GROUP_LABELS.forearm} (拖拽中)`
    updates = createUpdates(currentAngles, {
      elbow_joint: moveY,
      wrist_1_joint: moveX,
    })
  } else if (handState.activeGroup === 'shoulder' && handState.isDragging) {
    highlightedJoints = ['shoulder_pan_joint', 'shoulder_lift_joint']
    summary = precisionMode
      ? `${HAND_GROUP_LABELS.shoulder} (拖拽中 / 精细模式)`
      : `${HAND_GROUP_LABELS.shoulder} (拖拽中)`
    updates = createUpdates(currentAngles, {
      shoulder_pan_joint: moveY,
      shoulder_lift_joint: moveX,
    })
  } else if (handState.activeGroup) {
    summary = `${HAND_GROUP_LABELS[handState.activeGroup]} 已选中，右手抓握并移动`
  }

  const mappedGrab = applyDeadzone(rightGrabStrength, config.gripperPinchThreshold)
  const mappedGripper = config.gripperMin + mappedGrab * (config.gripperMax - config.gripperMin)
  handState.gripper = lowPass(handState.gripper, mappedGripper, config.gripperSmoothing)
  const gripperPosition = clamp(handState.gripper, config.gripperMin, config.gripperMax)

  const hasJointUpdate = Object.keys(updates).length > 0
  const hasGripperUpdate = Math.abs(gripperPosition - currentGripperPosition) > 0.004

  return {
    updates,
    highlightedJoints,
    summary,
    directionLabel,
    gripperPosition,
    hasCommand: hasJointUpdate || hasGripperUpdate,
  }
}
