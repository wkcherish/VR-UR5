const LOCAL_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

const isLoopbackApiUrl = (value: string) => {
  try {
    const parsed = new URL(value)
    return LOCAL_LOOPBACK_HOSTS.has(parsed.hostname)
  } catch {
    return false
  }
}

export const resolveApiBaseUrl = () => {
  const configured = (import.meta.env.VITE_API_URL || '').trim()
  if (!configured) {
    return '/api'
  }

  if (!configured.startsWith('http://') && !configured.startsWith('https://')) {
    return configured
  }

  // Quest 等局域网设备访问时，localhost 会指向设备自身；自动回退到同源 /api 代理。
  if (typeof window !== 'undefined' && isLoopbackApiUrl(configured) && !LOCAL_LOOPBACK_HOSTS.has(window.location.hostname)) {
    return '/api'
  }

  return configured
}

