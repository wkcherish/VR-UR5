import { onUnmounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRobotStore } from '@/stores/robot'

interface UseRobotOptions {
  pollingInterval?: number
}

export const useRobot = (options: UseRobotOptions = {}) => {
  const { pollingInterval = 100 } = options
  const store = useRobotStore()
  const { isConnected, isLoading, isFetchingState, isSendingCommand, error, currentState, targetAngles, lastUpdatedAt } =
    storeToRefs(store)

  let pollingTimer: number | null = null

  const stopPolling = () => {
    if (pollingTimer !== null) {
      window.clearInterval(pollingTimer)
      pollingTimer = null
    }
  }

  const startPolling = () => {
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
        return
      }
      stopPolling()
    },
    { immediate: true },
  )

  onUnmounted(() => {
    stopPolling()
  })

  return {
    ...store,
    isConnected,
    isLoading,
    isFetchingState,
    isSendingCommand,
    error,
    currentState,
    targetAngles,
    lastUpdatedAt,
    startPolling,
    stopPolling,
  }
}
