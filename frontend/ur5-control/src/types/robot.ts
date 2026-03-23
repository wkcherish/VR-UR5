export const JOINT_ORDER = [
  'shoulder_pan_joint',
  'shoulder_lift_joint',
  'elbow_joint',
  'wrist_1_joint',
  'wrist_2_joint',
  'wrist_3_joint',
] as const

export type JointName = (typeof JOINT_ORDER)[number]

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
  current_ctrl: number[]
}

export type JointAngles = Record<JointName, number>
