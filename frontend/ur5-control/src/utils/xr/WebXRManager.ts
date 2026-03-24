import * as THREE from 'three'
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js'

export type XRSessionModeType = 'inline' | 'immersive-ar' | 'immersive-vr'
export type XRInteractionMode = 'controller' | 'hand'
export type XRActiveInputKind = XRInteractionMode | 'none'

export interface XRSupportState {
  ar: boolean
  vr: boolean
}

export interface XRHudState {
  statusMessage: string
  connectionState: string
  controlSummary: string
  directionLabel: string
  jointAnglesText: string
}

export interface XRControllerState {
  index: number
  connected: boolean
  handedness: XRHandedness | 'unknown'
  hasHandTracking: boolean
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  axes: number[]
  buttons: number[]
  selecting: boolean
}

type SessionEventListener = (isActive: boolean) => void
type ActiveInputListener = (activeInput: XRActiveInputKind) => void

const MAX_CONTROLLER_COUNT = 2
const HAND_MARKER_COLOR = 0x38bdf8

const createSupportState = (): XRSupportState => ({ ar: false, vr: false })

export class WebXRManager {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly controllers: THREE.Group[]
  private readonly controllerGrips: THREE.Group[]
  private readonly hands: THREE.Group[]
  private readonly sessionListeners: SessionEventListener[] = []
  private readonly activeInputListeners: ActiveInputListener[] = []
  private readonly hudCanvas: HTMLCanvasElement
  private readonly hudContext: CanvasRenderingContext2D
  private readonly hudTexture: THREE.CanvasTexture
  private readonly hudMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>

  private supportState: XRSupportState = createSupportState()
  private session: XRSession | null = null
  private sessionMode: XRSessionModeType | null = null
  private inputMode: XRInteractionMode = 'controller'
  private activeInput: XRActiveInputKind = 'none'
  private hudDirty = true
  private hudState: XRHudState = {
    statusMessage: '等待 XR 会话',
    connectionState: '后端未连接',
    controlSummary: '等待控制输入',
    directionLabel: '等待摇杆输入',
    jointAnglesText: '--',
  }

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.renderer = renderer
    this.scene = scene
    this.camera = camera
    this.renderer.xr.enabled = true

    this.controllers = []
    this.controllerGrips = []
    this.hands = []

    const controllerModelFactory = new XRControllerModelFactory()

    for (let index = 0; index < MAX_CONTROLLER_COUNT; index += 1) {
      const controller = this.renderer.xr.getController(index)
      const grip = this.renderer.xr.getControllerGrip(index)
      const hand = this.renderer.xr.getHand(index)

      grip.add(controllerModelFactory.createControllerModel(grip))
      hand.add(this.createHandMarker())

      this.controllers.push(controller)
      this.controllerGrips.push(grip)
      this.hands.push(hand)

      this.scene.add(controller)
      this.scene.add(grip)
      this.scene.add(hand)
    }

    this.hudCanvas = document.createElement('canvas')
    this.hudCanvas.width = 1024
    this.hudCanvas.height = 512
    const context = this.hudCanvas.getContext('2d')
    if (!context) {
      throw new Error('无法初始化 XR HUD 画布上下文')
    }
    this.hudContext = context
    this.hudTexture = new THREE.CanvasTexture(this.hudCanvas)
    this.hudTexture.colorSpace = THREE.SRGBColorSpace
    this.hudTexture.needsUpdate = true

    this.hudMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 0.36),
      new THREE.MeshBasicMaterial({
        map: this.hudTexture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    )
    this.hudMesh.position.set(0, -0.14, -1.05)
    this.hudMesh.renderOrder = 100
    this.hudMesh.visible = false
    this.camera.add(this.hudMesh)

    this.drawHud()
    this.updateInputVisuals()
  }

  private createHandMarker() {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.01, 10, 10),
      new THREE.MeshBasicMaterial({
        color: HAND_MARKER_COLOR,
        transparent: true,
        opacity: 0.85,
      }),
    )
    marker.position.set(0, 0, -0.02)
    return marker
  }

  private async isModeSupported(mode: XRSessionModeType) {
    const xr = navigator.xr
    if (!xr) {
      return false
    }
    try {
      return await xr.isSessionSupported(mode)
    } catch {
      return false
    }
  }

  async checkSupport() {
    const xr = navigator.xr
    if (!xr) {
      this.supportState = createSupportState()
      return { ...this.supportState }
    }

    const [ar, vr] = await Promise.all([
      this.isModeSupported('immersive-ar'),
      this.isModeSupported('immersive-vr'),
    ])

    this.supportState = { ar, vr }
    return { ...this.supportState }
  }

  getSupportState() {
    return { ...this.supportState }
  }

  getSessionMode() {
    return this.sessionMode
  }

  getInputMode() {
    return this.inputMode
  }

  setInputMode(mode: XRInteractionMode) {
    this.inputMode = mode
    this.updateInputVisuals()
    this.updateActiveInputFromSources()
    this.hudDirty = true
  }

  getActiveInput() {
    return this.activeInput
  }

  isSessionActive() {
    return this.session !== null
  }

  onSessionChange(listener: SessionEventListener) {
    this.sessionListeners.push(listener)
    return () => {
      const index = this.sessionListeners.indexOf(listener)
      if (index >= 0) {
        this.sessionListeners.splice(index, 1)
      }
    }
  }

  onActiveInputChange(listener: ActiveInputListener) {
    this.activeInputListeners.push(listener)
    return () => {
      const index = this.activeInputListeners.indexOf(listener)
      if (index >= 0) {
        this.activeInputListeners.splice(index, 1)
      }
    }
  }

  private emitSessionChange(isActive: boolean) {
    for (const listener of this.sessionListeners) {
      listener(isActive)
    }
  }

  private setActiveInput(next: XRActiveInputKind) {
    if (next === this.activeInput) {
      return
    }
    this.activeInput = next
    for (const listener of this.activeInputListeners) {
      listener(next)
    }
    this.hudDirty = true
  }

  private updateActiveInputFromSources() {
    const sources = Array.from(this.session?.inputSources ?? [])
    const hasHand = sources.some((source) => Boolean(source.hand))
    const hasController = sources.some((source) => Boolean(source.gamepad))

    if (this.inputMode === 'hand' && hasHand) {
      this.setActiveInput('hand')
      return
    }
    if (this.inputMode === 'controller' && hasController) {
      this.setActiveInput('controller')
      return
    }
    if (hasHand) {
      this.setActiveInput('hand')
      return
    }
    if (hasController) {
      this.setActiveInput('controller')
      return
    }
    this.setActiveInput('none')
  }

  private updateInputVisuals() {
    const sources = this.session?.inputSources ?? []
    for (let index = 0; index < MAX_CONTROLLER_COUNT; index += 1) {
      const source = sources[index]
      const hasControllerInput = Boolean(source?.gamepad)
      const hasHandTracking = Boolean(source?.hand)

      this.controllers[index].visible = this.inputMode === 'controller' && hasControllerInput
      this.controllerGrips[index].visible = this.inputMode === 'controller' && hasControllerInput
      this.hands[index].visible = this.inputMode === 'hand' && hasHandTracking
    }
  }

  private cleanupSessionState() {
    this.session = null
    this.sessionMode = null
    this.setActiveInput('none')
    this.hudMesh.visible = false
    this.updateInputVisuals()
    this.hudDirty = true
  }

  private handleSessionEnd = () => {
    if (!this.session) {
      return
    }
    this.session.removeEventListener('inputsourceschange', this.handleInputSourcesChange)
    this.cleanupSessionState()
    this.emitSessionChange(false)
  }

  private handleInputSourcesChange = () => {
    this.updateActiveInputFromSources()
    this.updateInputVisuals()
  }

  private isRetryableSessionError(error: unknown) {
    if (error instanceof DOMException) {
      return error.name === 'NotSupportedError'
    }
    if (error instanceof Error) {
      return /not supported|configuration is not supported/i.test(error.message)
    }
    return false
  }

  private getSessionInitCandidates(mode: XRSessionModeType): XRSessionInit[] {
    if (mode === 'inline') {
      return [
        { optionalFeatures: ['hand-tracking'] },
        {},
      ]
    }

    if (mode === 'immersive-ar') {
      return [
        {
          optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'dom-overlay'],
          domOverlay: { root: document.body },
        } as XRSessionInit,
        {
          optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
        },
        {
          optionalFeatures: ['local-floor'],
        },
        {},
      ]
    }

    return [
      {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'dom-overlay'],
        domOverlay: { root: document.body },
      } as XRSessionInit,
      {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
      },
      {
        optionalFeatures: ['local-floor', 'bounded-floor'],
      },
      {
        optionalFeatures: ['local-floor'],
      },
      {},
    ]
  }

  async startSession(mode: XRSessionModeType = 'inline') {
    if (this.session && this.sessionMode === mode) {
      return
    }
    if (this.session) {
      await this.endSession()
    }

    const xr = navigator.xr
    if (!xr) {
      throw new Error('当前浏览器不支持 WebXR')
    }

    const initCandidates = this.getSessionInitCandidates(mode)
    let session: XRSession | null = null
    let lastError: unknown = null

    for (const sessionInit of initCandidates) {
      try {
        session = await xr.requestSession(mode, sessionInit)
        break
      } catch (error) {
        lastError = error
        if (!this.isRetryableSessionError(error)) {
          throw error
        }
      }
    }

    if (!session) {
      if (lastError instanceof Error) {
        throw new Error(`VR 会话启动失败：${lastError.message}`)
      }
      throw new Error('VR 会话启动失败：当前设备不支持可用的会话配置')
    }

    session.addEventListener('end', this.handleSessionEnd)
    session.addEventListener('inputsourceschange', this.handleInputSourcesChange)
    await this.renderer.xr.setSession(session)

    if (mode === 'immersive-vr') {
      this.camera.position.y = Math.max(this.camera.position.y, 1.6)
    }

    this.session = session
    this.sessionMode = mode
    this.hudMesh.visible = mode === 'immersive-vr'
    this.updateActiveInputFromSources()
    this.updateInputVisuals()
    this.hudDirty = true
    this.emitSessionChange(true)
  }

  async endSession() {
    if (!this.session) {
      return
    }

    const current = this.session
    this.session = null
    current.removeEventListener('end', this.handleSessionEnd)
    current.removeEventListener('inputsourceschange', this.handleInputSourcesChange)
    this.cleanupSessionState()

    try {
      await current.end()
    } finally {
      this.emitSessionChange(false)
    }
  }

  updateFrame() {
    if (!this.session) {
      return
    }
    this.updateActiveInputFromSources()
    this.updateInputVisuals()
    if (this.hudDirty) {
      this.drawHud()
    }
  }

  setHudState(nextState: Partial<XRHudState>) {
    this.hudState = {
      ...this.hudState,
      ...nextState,
    }
    this.hudDirty = true
  }

  private drawHud() {
    const context = this.hudContext
    const width = this.hudCanvas.width
    const height = this.hudCanvas.height

    context.clearRect(0, 0, width, height)
    context.fillStyle = 'rgba(8, 15, 33, 0.78)'
    context.fillRect(0, 0, width, height)
    context.strokeStyle = 'rgba(56, 189, 248, 0.62)'
    context.lineWidth = 8
    context.strokeRect(4, 4, width - 8, height - 8)

    context.fillStyle = '#7dd3fc'
    context.font = 'bold 38px "Segoe UI", sans-serif'
    context.fillText(`XR ${this.sessionMode ?? 'idle'} | ${this.inputMode}`, 48, 72)

    context.fillStyle = '#e2e8f0'
    context.font = '26px "Segoe UI", sans-serif'
    context.fillText(`输入源: ${this.activeInput}`, 48, 130)
    context.fillText(this.hudState.connectionState, 48, 176)
    context.fillText(`控制: ${this.hudState.controlSummary}`, 48, 222)
    context.fillText(`方向: ${this.hudState.directionLabel}`, 48, 268)
    context.fillText(`关节: ${this.hudState.jointAnglesText}`, 48, 314)

    context.fillStyle = '#cbd5e1'
    context.font = '22px "Segoe UI", sans-serif'
    context.fillText(this.hudState.statusMessage, 48, 366)

    this.hudTexture.needsUpdate = true
    this.hudDirty = false
  }

  getControllerStates() {
    const inputSources = this.session?.inputSources ?? []
    const states: XRControllerState[] = []

    for (let index = 0; index < MAX_CONTROLLER_COUNT; index += 1) {
      const controller = this.controllers[index]
      const source = inputSources[index]
      const gamepad = source?.gamepad
      const buttons = gamepad?.buttons.map((button) => button.value) ?? []
      const hasHandTracking = Boolean(source?.hand)
      const trackedNode = hasHandTracking ? this.hands[index] : controller

      states.push({
        index,
        connected: Boolean(source),
        handedness: source?.handedness ?? 'unknown',
        hasHandTracking,
        position: trackedNode.position.clone(),
        quaternion: trackedNode.quaternion.clone(),
        axes: gamepad?.axes ? [...gamepad.axes] : [],
        buttons,
        selecting: (buttons[0] ?? 0) > 0.5,
      })
    }

    return states
  }

  dispose() {
    if (this.session) {
      void this.endSession()
    }

    this.camera.remove(this.hudMesh)
    this.hudMesh.geometry.dispose()
    this.hudMesh.material.dispose()
    this.hudTexture.dispose()

    for (const controller of this.controllers) {
      this.scene.remove(controller)
    }
    for (const grip of this.controllerGrips) {
      this.scene.remove(grip)
    }
    for (const hand of this.hands) {
      this.scene.remove(hand)
    }
  }
}
