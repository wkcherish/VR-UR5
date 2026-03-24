export const JOINT_ORDER = [
  'shoulder_pan_joint',
  'shoulder_lift_joint',
  'elbow_joint',
  'wrist_1_joint',
  'wrist_2_joint',
  'wrist_3_joint',
] as const

export type JointName = (typeof JOINT_ORDER)[number]

export const JOINT_LIMITS: Record<JointName, { lower: number; upper: number }> = {
  shoulder_pan_joint: { lower: -2 * Math.PI, upper: 2 * Math.PI },
  shoulder_lift_joint: { lower: -2 * Math.PI, upper: 2 * Math.PI },
  elbow_joint: { lower: -Math.PI, upper: Math.PI },
  wrist_1_joint: { lower: -2 * Math.PI, upper: 2 * Math.PI },
  wrist_2_joint: { lower: -2 * Math.PI, upper: 2 * Math.PI },
  wrist_3_joint: { lower: -2 * Math.PI, upper: 2 * Math.PI },
}

export const clampJointAngle = (jointName: JointName, value: number): number => {
  const { lower, upper } = JOINT_LIMITS[jointName]
  return Math.min(upper, Math.max(lower, value))
}

export interface JointState {
  joint_name: string
  position: number
  velocity: number
}

export interface RobotState {
  joints: JointState[]
  qpos: number[]
  qvel: number[]
  gripper_position?: number | null
}

export interface ControlInput {
  target_angles: number[]
  gripper_position?: number
}

export interface ApiResponse<T = unknown> {
  status: string
  message: string
  data?: T
}

export interface ControlResponse {
  status: string
  message: string
  target_angles: number[]
  gripper_position?: number | null
  current_ctrl: number[]
}

export type JointAngles = Record<JointName, number>
