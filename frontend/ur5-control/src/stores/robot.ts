import { defineStore } from 'pinia'
import { robotApi } from '@/services/robotApi'
import { JOINT_ORDER } from '@/types/robot'
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
const TARGET_SYNC_GRACE_MS = 300
const ARM_MIN = -Math.PI
const ARM_MAX = Math.PI
const GRIPPER_MIN = 0
const GRIPPER_MAX = 0.9
const DEFAULT_GRIPPER_POSITION = 0.8
const clampArmAngle = (value: number) => clamp(value, ARM_MIN, ARM_MAX)
const clampGripper = (value: number) => clamp(value, GRIPPER_MIN, GRIPPER_MAX)

const applyStateToTargetAngles = (targetAngles: JointAngles, state: RobotState) => {
  for (const joint of state.joints) {
    if (joint.joint_name in targetAngles) {
      const jointName = joint.joint_name as JointName
      targetAngles[jointName] = joint.position
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
  },

  actions: {
    setTargetAngle(jointName: JointName, angle: number) {
      this.targetAngles[jointName] = clampArmAngle(angle)
      this.lastLocalInputAt = Date.now()
    },

    setTargetGripperPosition(position: number) {
      this.targetGripperPosition = clampGripper(position)
      this.lastLocalInputAt = Date.now()
    },

    syncTargetAnglesFromState(force = false) {
      if (!this.currentState) {
        return
      }
      if (!force && Date.now() - this.lastLocalInputAt < TARGET_SYNC_GRACE_MS) {
        return
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
        this.currentState = state
        this.lastUpdatedAt = Date.now()
        this.syncTargetAnglesFromState()
        this.error = ''
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
        return
      }
      this.isSendingCommand = true
      try {
        this.lastLocalInputAt = Date.now()
        let nextAngles: JointAngles = {
          ...this.currentPositions,
          ...this.targetAngles,
          ...angles,
        }
        let nextGripperPosition = clampGripper(gripperPosition ?? this.targetGripperPosition)

        while (true) {
          const target = JOINT_ORDER.map((jointName) => clampArmAngle(nextAngles[jointName]))
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

          this.lastLocalInputAt = Date.now()
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
