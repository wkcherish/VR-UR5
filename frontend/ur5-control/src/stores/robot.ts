import { defineStore } from 'pinia'
import { robotApi } from '@/services/robotApi'
import { JOINT_ORDER, clampJointAngle } from '@/types/robot'
import type { JointAngles, JointName, RobotState } from '@/types/robot'

const createDefaultAngles = (): JointAngles => ({
  shoulder_pan_joint: 0,
  shoulder_lift_joint: 0,
  elbow_joint: 0,
  wrist_1_joint: 0,
  wrist_2_joint: 0,
  wrist_3_joint: 0,
})

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
const TARGET_SYNC_GRACE_MS = 160
const TARGET_SYNC_MAX_HOLD_MS = 700
const TARGET_REACHED_EPSILON_RAD = 0.04
const GRIPPER_REACHED_EPSILON_RAD = 0.02
const LOCAL_CONTROL_AUTO_RELEASE_MS = 180
const GRIPPER_MIN = 0
const GRIPPER_MAX = 0.9
const DEFAULT_GRIPPER_POSITION = 0.8
const clampGripper = (value: number) => clamp(value, GRIPPER_MIN, GRIPPER_MAX)

const isStateNearTarget = (state: RobotState, targetAngles: JointAngles, targetGripperPosition: number) => {
  const currentMap: Partial<Record<JointName, number>> = {}
  for (const joint of state.joints) {
    if (joint.joint_name in targetAngles) {
      currentMap[joint.joint_name as JointName] = joint.position
    }
  }

  for (const jointName of JOINT_ORDER) {
    const current = currentMap[jointName]
    if (current === undefined) {
      return false
    }
    if (Math.abs(current - targetAngles[jointName]) > TARGET_REACHED_EPSILON_RAD) {
      return false
    }
  }

  const gripperCurrent = state.gripper_position
  if (gripperCurrent !== null && gripperCurrent !== undefined) {
    if (Math.abs(gripperCurrent - targetGripperPosition) > GRIPPER_REACHED_EPSILON_RAD) {
      return false
    }
  }

  return true
}

const applyStateToTargetAngles = (targetAngles: JointAngles, state: RobotState) => {
  for (const joint of state.joints) {
    if (joint.joint_name in targetAngles) {
      const jointName = joint.joint_name as JointName
      targetAngles[jointName] = clampJointAngle(jointName, joint.position)
    }
  }
}

export const useRobotStore = defineStore('robot', {
  state: () => ({
    isConnected: false,
    isLoading: false,
    isFetchingState: false,
    isSendingCommand: false,
    error: '',
    currentState: null as RobotState | null,
    targetAngles: createDefaultAngles(),
    pendingCommandAngles: null as Partial<JointAngles> | null,
    targetGripperPosition: DEFAULT_GRIPPER_POSITION,
    pendingGripperPosition: null as number | null,
    isLocalControlling: false,
    localControlUntil: 0,
    lastLocalInputAt: 0,
    lastUpdatedAt: 0,
  }),

  getters: {
    jointStates: (state) => state.currentState?.joints ?? [],
    currentPositions: (state): JointAngles => {
      const positions = createDefaultAngles()
      for (const joint of state.currentState?.joints ?? []) {
        if (joint.joint_name in positions) {
          const jointName = joint.joint_name as JointName
          positions[jointName] = joint.position
        }
      }
      return positions
    },
    currentGripperPosition: (state): number => {
      const gripper = state.currentState?.gripper_position
      if (gripper === null || gripper === undefined) {
        return DEFAULT_GRIPPER_POSITION
      }
      return clampGripper(gripper)
    },
    shouldHoldLocalPose: (state): boolean => {
      if (state.isLocalControlling || state.isSendingCommand || Boolean(state.pendingCommandAngles) || state.pendingGripperPosition !== null) {
        return true
      }
      return false
    },
  },

  actions: {
    applyRemoteState(state: RobotState) {
      this.currentState = state
      this.lastUpdatedAt = Date.now()
      this.syncTargetAnglesFromState()
      this.error = ''
    },

    setTargetAngle(jointName: JointName, angle: number) {
      this.targetAngles[jointName] = clampJointAngle(jointName, angle)
      this.lastLocalInputAt = Date.now()
    },

    setTargetGripperPosition(position: number) {
      this.targetGripperPosition = clampGripper(position)
      this.lastLocalInputAt = Date.now()
    },

    markLocalControlActivity() {
      this.lastLocalInputAt = Date.now()
      this.isLocalControlling = true
      this.localControlUntil = this.lastLocalInputAt + LOCAL_CONTROL_AUTO_RELEASE_MS
    },

    refreshLocalControlState() {
      if (!this.isLocalControlling) {
        return
      }
      if (Date.now() > this.localControlUntil) {
        this.isLocalControlling = false
      }
    },

    syncTargetAnglesFromState(force = false) {
      if (!this.currentState) {
        return
      }
      const now = Date.now()
      this.refreshLocalControlState()

      if (!force) {
        if (this.isLocalControlling) {
          return
        }
        if (now - this.lastLocalInputAt < TARGET_SYNC_GRACE_MS) {
          return
        }
        if (this.isSendingCommand || this.pendingCommandAngles || this.pendingGripperPosition !== null) {
          return
        }
        if (
          now - this.lastLocalInputAt < TARGET_SYNC_MAX_HOLD_MS
          && !isStateNearTarget(this.currentState, this.targetAngles, this.targetGripperPosition)
        ) {
          return
        }
      }

      applyStateToTargetAngles(this.targetAngles, this.currentState)
      if (this.currentState.gripper_position !== null && this.currentState.gripper_position !== undefined) {
        this.targetGripperPosition = clampGripper(this.currentState.gripper_position)
      }
    },

    async connect() {
      this.isLoading = true
      this.error = ''
      try {
        await this.fetchState()
        this.syncTargetAnglesFromState(true)
        this.isConnected = true
      } catch (error) {
        this.isConnected = false
        this.error = error instanceof Error ? error.message : '连接失败'
      } finally {
        this.isLoading = false
      }
    },

    async fetchState() {
      if (this.isFetchingState) {
        return
      }
      this.isFetchingState = true
      try {
        const state = await robotApi.getState()
        this.applyRemoteState(state)
      } catch (error) {
        this.error = error instanceof Error ? error.message : '状态获取失败'
        throw error
      } finally {
        this.isFetchingState = false
      }
    },

    async sendCommand(angles?: Partial<JointAngles>, gripperPosition?: number) {
      if (this.isSendingCommand) {
        const queuedAngles = angles ?? { ...this.targetAngles }
        this.pendingCommandAngles = { ...(this.pendingCommandAngles ?? {}), ...queuedAngles }
        this.pendingGripperPosition = clampGripper(gripperPosition ?? this.targetGripperPosition)
        this.markLocalControlActivity()
        return
      }
      this.isSendingCommand = true
      try {
        this.markLocalControlActivity()
        let nextAngles: JointAngles = {
          ...this.currentPositions,
          ...this.targetAngles,
          ...angles,
        }
        let nextGripperPosition = clampGripper(gripperPosition ?? this.targetGripperPosition)

        while (true) {
          const target = JOINT_ORDER.map((jointName) => clampJointAngle(jointName, nextAngles[jointName]))
          await robotApi.control({
            target_angles: target,
            gripper_position: nextGripperPosition,
          })
          for (const [index, jointName] of JOINT_ORDER.entries()) {
            this.targetAngles[jointName] = target[index]
          }
          this.targetGripperPosition = nextGripperPosition

          if (!this.pendingCommandAngles && this.pendingGripperPosition === null) {
            break
          }

          this.markLocalControlActivity()
          nextAngles = {
            ...this.currentPositions,
            ...this.targetAngles,
            ...this.pendingCommandAngles,
          }
          nextGripperPosition = clampGripper(this.pendingGripperPosition ?? this.targetGripperPosition)
          this.pendingCommandAngles = null
          this.pendingGripperPosition = null
        }
        this.error = ''
      } catch (error) {
        // 避免请求异常后残留 pending 状态，导致前端持续“本地占用”而不接收远端姿态。
        this.pendingCommandAngles = null
        this.pendingGripperPosition = null
        this.isLocalControlling = false
        this.localControlUntil = 0
        this.error = error instanceof Error ? error.message : '控制指令发送失败'
        throw error
      } finally {
        this.isSendingCommand = false
      }
    },

    async reset() {
      this.isLoading = true
      try {
        await robotApi.reset()
        await this.fetchState()
        this.targetAngles = createDefaultAngles()
        this.targetGripperPosition = DEFAULT_GRIPPER_POSITION
        this.pendingGripperPosition = null
        this.isLocalControlling = false
        this.localControlUntil = 0
        this.lastLocalInputAt = 0
        this.syncTargetAnglesFromState(true)
        this.error = ''
      } catch (error) {
        this.error = error instanceof Error ? error.message : '重置失败'
        throw error
      } finally {
        this.isLoading = false
      }
    },

    disconnect() {
      this.isConnected = false
    },
  },
})
