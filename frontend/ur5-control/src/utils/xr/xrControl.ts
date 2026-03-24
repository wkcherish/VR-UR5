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

export interface XRControlOptions {
  deadzone?: number
  jointStep?: number
  precisionScale?: number
  stickSmoothing?: number
  gripperSmoothing?: number
  gripperMin?: number
  gripperMax?: number
}

const DEFAULT_OPTIONS: Required<XRControlOptions> = {
  deadzone: 0.1,
  jointStep: 0.07,
  precisionScale: 0.4,
  stickSmoothing: 0.25,
  gripperSmoothing: 0.16,
  gripperMin: 0,
  gripperMax: 0.9,
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const getControllerByHandedness = (controllers: XRControllerState[], handedness: XRHandedness) =>
  controllers.find((controller) => controller.connected && controller.handedness === handedness)

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
