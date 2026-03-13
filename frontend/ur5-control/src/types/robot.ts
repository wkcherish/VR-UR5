// 机器人关节状态接口
export interface JointState {
  joint_name: string
  position: number
  velocity: number
}

// 机器人完整状态接口
export interface RobotState {
  joints: JointState[]
  qpos: number[]
  qvel: number[]
}

// 控制输入接口
export interface ControlInput {
  target_angles: number[]
}

// API 响应接口
export interface ApiResponse<T = any> {
  status: string
  message: string
  data?: T
}
