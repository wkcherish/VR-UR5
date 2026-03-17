import * as THREE from 'three'

export interface XRControllerState {
  index: number
  connected: boolean
  handedness: XRHandedness | 'unknown'
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  axes: number[]
  buttons: number[]
  selecting: boolean
}

type SessionEventListener = (isActive: boolean) => void

export class WebXRManager {
  private readonly renderer: THREE.WebGLRenderer
  private readonly controllers: THREE.Group[]
  private readonly selectingState: boolean[]
  private session: XRSession | null = null
  private supported: boolean | null = null
  private sessionListeners: SessionEventListener[] = []

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer
    this.renderer.xr.enabled = true
    this.controllers = [this.renderer.xr.getController(0), this.renderer.xr.getController(1)]
    this.selectingState = [false, false]

    for (const [index, controller] of this.controllers.entries()) {
      controller.addEventListener('selectstart', () => {
        this.selectingState[index] = true
      })
      controller.addEventListener('selectend', () => {
        this.selectingState[index] = false
      })
    }
  }

  async checkSupport() {
    const xr = navigator.xr
    if (!xr) {
      this.supported = false
      return false
    }
    const supported = await xr.isSessionSupported('immersive-ar')
    this.supported = supported
    return supported
  }

  getSupportState() {
    return this.supported
  }

  isSessionActive() {
    return this.session !== null
  }

  onSessionChange(listener: SessionEventListener) {
    this.sessionListeners.push(listener)
    return () => {
      this.sessionListeners = this.sessionListeners.filter((item) => item !== listener)
    }
  }

  private emitSessionChange(isActive: boolean) {
    for (const listener of this.sessionListeners) {
      listener(isActive)
    }
  }

  private handleSessionEnd = () => {
    this.session = null
    this.emitSessionChange(false)
  }

  async startSession() {
    if (this.session) {
      return
    }
    const xr = navigator.xr
    if (!xr) {
      throw new Error('当前浏览器不支持 WebXR')
    }
    const session = await xr.requestSession('immersive-ar', {
      optionalFeatures: ['local-floor', 'bounded-floor', 'dom-overlay'],
      domOverlay: { root: document.body },
    })
    session.addEventListener('end', this.handleSessionEnd)
    await this.renderer.xr.setSession(session)
    this.session = session
    this.emitSessionChange(true)
  }

  async endSession() {
    if (!this.session) {
      return
    }
    const next = this.session
    this.session = null
    next.removeEventListener('end', this.handleSessionEnd)
    await next.end()
    this.emitSessionChange(false)
  }

  getControllerStates() {
    const states: XRControllerState[] = []
    const inputSources = this.session?.inputSources ?? []

    for (const [index, controller] of this.controllers.entries()) {
      const inputSource = inputSources[index]
      const gamepad = inputSource?.gamepad

      states.push({
        index,
        connected: Boolean(inputSource),
        handedness: inputSource?.handedness ?? 'unknown',
        position: controller.position.clone(),
        quaternion: controller.quaternion.clone(),
        axes: gamepad?.axes ? [...gamepad.axes] : [],
        buttons: gamepad?.buttons.map((button) => button.value) ?? [],
        selecting: this.selectingState[index],
      })
    }

    return states
  }
}
