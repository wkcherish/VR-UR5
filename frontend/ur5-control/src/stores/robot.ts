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

export const useRobotStore = defineStore('robot', {
  state: () => ({
    isConnected: false,
    isLoading: false,
    isFetchingState: false,
    isSendingCommand: false,
    error: '',
    currentState: null as RobotState | null,
    targetAngles: createDefaultAngles(),
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
  },

  actions: {
    setTargetAngle(jointName: JointName, angle: number) {
      this.targetAngles[jointName] = clamp(angle, -Math.PI, Math.PI)
    },

    async connect() {
      this.isLoading = true
      this.error = ''
      try {
        await this.fetchState()
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
        for (const joint of state.joints) {
          if (joint.joint_name in this.targetAngles) {
            const jointName = joint.joint_name as JointName
            this.targetAngles[jointName] = joint.position
          }
        }
        this.error = ''
      } catch (error) {
        this.error = error instanceof Error ? error.message : '状态获取失败'
        throw error
      } finally {
        this.isFetchingState = false
      }
    },

    async sendCommand(angles?: Partial<JointAngles>) {
      if (this.isSendingCommand) {
        return
      }
      this.isSendingCommand = true
      try {
        const nextAngles: JointAngles = { ...this.targetAngles, ...angles }
        const target = JOINT_ORDER.map((jointName) => clamp(nextAngles[jointName], -Math.PI, Math.PI))
        await robotApi.control({ target_angles: target })
        for (const [index, jointName] of JOINT_ORDER.entries()) {
          this.targetAngles[jointName] = target[index]
        }
        await this.fetchState()
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
        this.targetAngles = createDefaultAngles()
        await this.fetchState()
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
