import { onUnmounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRobotStore } from '@/stores/robot'
import { setRealtimeControlTransport } from '@/services/robotApi'
import { resolveApiBaseUrl } from '@/services/apiBase'
import type { ControlInput, ControlResponse, RobotState } from '@/types/robot'

interface UseRobotOptions {
  pollingInterval?: number
}

export const useRobot = (options: UseRobotOptions = {}) => {
  const { pollingInterval = 100 } = options
  const store = useRobotStore()
  const {
    isConnected,
    isLoading,
    isFetchingState,
    isSendingCommand,
    isLocalControlling,
    shouldHoldLocalPose,
    error,
    currentState,
    targetAngles,
    targetGripperPosition,
    lastUpdatedAt,
  } = storeToRefs(store)

  let pollingTimer: number | null = null
  let reconnectTimer: number | null = null
  let stateSocket: WebSocket | null = null
  let realtimeConnected = false
  let nextRealtimeRequestId = 1
  let pendingControlRequests = new Map<number, {
    resolve: (value: ControlResponse) => void
    reject: (reason?: unknown) => void
    timeoutId: number
  }>()

  const REALTIME_RECONNECT_MS = 500
  const REALTIME_CONTROL_ACK_TIMEOUT_MS = 700

  const toWsUrl = () => {
    const apiBase = resolveApiBaseUrl()
    const normalize = (value: string) => value.replace(/\/+$/, '')

    if (apiBase.startsWith('http://') || apiBase.startsWith('https://')) {
      return `${normalize(apiBase).replace(/^http/i, 'ws')}/ws/robot`
    }

    if (apiBase.startsWith('/')) {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      return `${wsProtocol}//${window.location.host}${normalize(apiBase)}/ws/robot`
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${wsProtocol}//${normalize(apiBase)}/ws/robot`
  }

  const stopPolling = () => {
    if (pollingTimer !== null) {
      window.clearInterval(pollingTimer)
      pollingTimer = null
    }
  }

  const clearReconnectTimer = () => {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  const stopRealtime = () => {
    clearReconnectTimer()
    realtimeConnected = false
    setRealtimeControlTransport(null)
    for (const request of pendingControlRequests.values()) {
      window.clearTimeout(request.timeoutId)
      request.reject(new Error('实时连接已断开'))
    }
    pendingControlRequests.clear()
    if (!stateSocket) {
      return
    }
    const socket = stateSocket
    stateSocket = null
    socket.onopen = null
    socket.onmessage = null
    socket.onclose = null
    socket.onerror = null
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close()
    }
  }

  const scheduleRealtimeReconnect = () => {
    if (!store.isConnected || stateSocket) {
      return
    }
    clearReconnectTimer()
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null
      startRealtime()
    }, REALTIME_RECONNECT_MS)
  }

  const applyRealtimeState = (payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return
    }
    const message = payload as { type?: unknown; state?: RobotState }
    if (message.type !== 'state' || !message.state) {
      return
    }
    store.applyRemoteState(message.state)
  }

  const sendRealtimeControl = (payload: ControlInput): Promise<ControlResponse> => {
    const socket = stateSocket
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('实时控制连接未建立'))
    }

    return new Promise<ControlResponse>((resolve, reject) => {
      const requestId = nextRealtimeRequestId++
      const timeoutId = window.setTimeout(() => {
        const request = pendingControlRequests.get(requestId)
        if (!request) {
          return
        }
        pendingControlRequests.delete(requestId)
        request.reject(new Error('实时控制应答超时'))
      }, REALTIME_CONTROL_ACK_TIMEOUT_MS)

      pendingControlRequests.set(requestId, { resolve, reject, timeoutId })

      try {
        socket.send(JSON.stringify({
          type: 'control',
          request_id: requestId,
          ...payload,
        }))
      } catch (error) {
        const request = pendingControlRequests.get(requestId)
        if (request) {
          window.clearTimeout(request.timeoutId)
          pendingControlRequests.delete(requestId)
        }
        reject(error)
      }
    })
  }

  const startRealtime = () => {
    if (!store.isConnected || stateSocket) {
      return
    }

    const socket = new WebSocket(toWsUrl())
    stateSocket = socket

    socket.onopen = () => {
      realtimeConnected = true
      clearReconnectTimer()
      stopPolling()
      setRealtimeControlTransport(sendRealtimeControl)
    }

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          type?: string
          state?: RobotState
          data?: ControlResponse
          request_id?: number
          message?: string
        }
        if (payload.type === 'state') {
          applyRealtimeState(payload)
          return
        }
        if (payload.type === 'control_ack') {
          const requestId = typeof payload.request_id === 'number' ? payload.request_id : null
          const fallbackRequestEntry = requestId === null
            ? pendingControlRequests.entries().next()
            : null
          const fallbackRequestId = fallbackRequestEntry && !fallbackRequestEntry.done
            ? fallbackRequestEntry.value[0]
            : null
          const resolvedRequestId = requestId ?? fallbackRequestId
          if (resolvedRequestId === null) {
            return
          }
          const request = pendingControlRequests.get(resolvedRequestId)
          if (request) {
            window.clearTimeout(request.timeoutId)
            pendingControlRequests.delete(resolvedRequestId)
          }
          if (request && payload.data) {
            request.resolve(payload.data)
          } else if (request) {
            request.reject(new Error('实时控制响应无效'))
          }
          return
        }
        if (payload.type === 'error') {
          const requestId = typeof payload.request_id === 'number' ? payload.request_id : null
          const fallbackRequestEntry = requestId === null
            ? pendingControlRequests.entries().next()
            : null
          const fallbackRequestId = fallbackRequestEntry && !fallbackRequestEntry.done
            ? fallbackRequestEntry.value[0]
            : null
          const resolvedRequestId = requestId ?? fallbackRequestId
          const request = resolvedRequestId === null ? undefined : pendingControlRequests.get(resolvedRequestId)
          if (request && resolvedRequestId !== null) {
            window.clearTimeout(request.timeoutId)
            pendingControlRequests.delete(resolvedRequestId)
          }
          const nextError = new Error(payload.message || '实时控制失败')
          if (request) {
            request.reject(nextError)
            return
          }
          store.error = nextError.message
        }
      } catch {}
    }

    socket.onerror = () => {
      socket.close()
    }

    socket.onclose = () => {
      if (stateSocket !== socket) {
        return
      }
      stateSocket = null
      realtimeConnected = false
      setRealtimeControlTransport(null)
      for (const request of pendingControlRequests.values()) {
        window.clearTimeout(request.timeoutId)
        request.reject(new Error('实时连接已断开'))
      }
      pendingControlRequests.clear()
      if (store.isConnected) {
        startPolling()
        scheduleRealtimeReconnect()
      }
    }
  }

  const startPolling = () => {
    if (realtimeConnected) {
      return
    }
    if (pollingTimer !== null) {
      return
    }
    pollingTimer = window.setInterval(async () => {
      if (!store.isConnected || store.isFetchingState) {
        return
      }
      try {
        await store.fetchState()
      } catch {}
    }, pollingInterval)
  }

  watch(
    () => store.isConnected,
    (connected) => {
      if (connected) {
        startPolling()
        startRealtime()
        return
      }
      stopPolling()
      stopRealtime()
    },
    { immediate: true },
  )

  onUnmounted(() => {
    stopPolling()
    stopRealtime()
  })

  return {
    ...store,
    isConnected,
    isLoading,
    isFetchingState,
    isSendingCommand,
    isLocalControlling,
    shouldHoldLocalPose,
    error,
    currentState,
    targetAngles,
    targetGripperPosition,
    lastUpdatedAt,
    startPolling,
    stopPolling,
    startRealtime,
    stopRealtime,
  }
}
