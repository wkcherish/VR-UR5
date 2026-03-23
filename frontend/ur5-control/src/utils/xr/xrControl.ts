import type { JointAngles, JointName } from '@/types/robot'
import type { XRControllerState } from '@/utils/xr/WebXRManager'

export interface XRControlFeedback {
  updates: Partial<JointAngles>
  highlightedJoints: JointName[]
  summary: string
  directionLabel: string
}

const deadzone = 0.12
const stepScale = 0.08

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

const normalizeAxis = (value: number) => (Math.abs(value) < deadzone ? 0 : value)

const isPressed = (buttons: number[], index: number) => (buttons[index] ?? 0) > 0.5

const clampAngle = (value: number) => Math.min(Math.PI, Math.max(-Math.PI, value))

const getDirectionLabel = (stickX: number, stickY: number) => {
  if (stickX === 0 && stickY === 0) {
    return '等待摇杆输入'
  }
  if (Math.abs(stickX) >= Math.abs(stickY)) {
    return stickX > 0 ? '摇杆向右' : '摇杆向左'
  }
  return stickY > 0 ? '摇杆向下' : '摇杆向上'
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
    updates[typedJointName] = clampAngle(currentAngles[typedJointName] + offset)
  }
  return updates
}

export const resolveXRControllerCommand = (
  controllers: XRControllerState[],
  currentAngles: JointAngles,
): XRControlFeedback => {
  const leftController = getControllerByHandedness(controllers, 'left')
  const rightController = getControllerByHandedness(controllers, 'right')

  if (!leftController || !rightController) {
    return {
      updates: {},
      highlightedJoints: [],
      summary: '等待左右手柄接入',
      directionLabel: '未检测到完整手柄',
    }
  }

  const stickX = normalizeAxis(getStickAxis(rightController.axes, 2, 0))
  const stickY = normalizeAxis(getStickAxis(rightController.axes, 3, 1))
  const directionLabel = getDirectionLabel(stickX, stickY)

  if (isPressed(leftController.buttons, 0)) {
    return {
      updates: createUpdates(currentAngles, {
        wrist_3_joint: stickX * stepScale,
      }),
      highlightedJoints: ['wrist_3_joint'],
      summary: 'Trigger 模式控制 Wrist 3',
      directionLabel,
    }
  }

  if (isPressed(leftController.buttons, 1)) {
    return {
      updates: createUpdates(currentAngles, {
        wrist_1_joint: stickY * stepScale,
        wrist_2_joint: stickX * stepScale,
      }),
      highlightedJoints: ['wrist_1_joint', 'wrist_2_joint'],
      summary: 'Grip 模式控制 Wrist 1 / Wrist 2',
      directionLabel,
    }
  }

  if (isPressed(leftController.buttons, 5)) {
    return {
      updates: createUpdates(currentAngles, {
        elbow_joint: stickY * stepScale,
      }),
      highlightedJoints: ['elbow_joint'],
      summary: 'Y 键模式控制 Elbow',
      directionLabel,
    }
  }

  if (isPressed(leftController.buttons, 4)) {
    return {
      updates: createUpdates(currentAngles, {
        shoulder_pan_joint: stickY * stepScale,
        shoulder_lift_joint: stickX * stepScale,
      }),
      highlightedJoints: ['shoulder_pan_joint', 'shoulder_lift_joint'],
      summary: 'X 键模式控制 Shoulder Pan / Shoulder Lift',
      directionLabel,
    }
  }

  return {
    updates: {},
    highlightedJoints: [],
    summary: '按住左手柄 X / Y / Grip / Trigger 选择关节',
    directionLabel,
  }
}
