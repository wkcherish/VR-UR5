import axios, { AxiosError } from 'axios'
import type {
  ControlInput,
  ControlResponse,
  JointName,
  JointState,
  RobotState,
} from '@/types/robot'

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 5000,
  headers: {
    'Content-Type': 'application/json',
  },
})

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ detail?: string }>) => {
    const detail = error.response?.data?.detail
    const message = detail || error.message || '请求失败'
    return Promise.reject(new Error(message))
  },
)

type RealtimeControlTransport = (payload: ControlInput) => Promise<ControlResponse>

let realtimeControlTransport: RealtimeControlTransport | null = null

export const setRealtimeControlTransport = (transport: RealtimeControlTransport | null) => {
  realtimeControlTransport = transport
}

export const robotApi = {
  async getState(): Promise<RobotState> {
    const { data } = await apiClient.get<RobotState>('/state')
    return data
  },

  async control(payload: ControlInput): Promise<ControlResponse> {
    if (realtimeControlTransport) {
      try {
        return await realtimeControlTransport(payload)
      } catch {}
    }
    const { data } = await apiClient.post<ControlResponse>('/control', payload)
    return data
  },

  async reset(): Promise<{ status: string; message: string }> {
    const { data } = await apiClient.post<{ status: string; message: string }>('/reset')
    return data
  },

  async getJointState(jointName: JointName): Promise<JointState> {
    const { data } = await apiClient.get<JointState>(`/joint/${jointName}`)
    return data
  },
}
