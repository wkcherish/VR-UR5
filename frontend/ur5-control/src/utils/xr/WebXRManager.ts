import * as THREE from 'three'
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js'
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js'

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
  handPinch: {
    index: number
    middle: number
    ring: number
  } | null
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  axes: number[]
  buttons: number[]
  selecting: boolean
}

export interface XRSessionStartOptions {
  preferHandTracking?: boolean
}

type SessionEventListener = (isActive: boolean) => void
type ActiveInputListener = (activeInput: XRActiveInputKind) => void

interface XRHandDebugMarkers {
  root: THREE.Group
  palm: THREE.Mesh
  thumbTip: THREE.Mesh
  indexTip: THREE.Mesh
  middleTip: THREE.Mesh
  ringTip: THREE.Mesh
}

const MAX_CONTROLLER_COUNT = 2
const HAND_MARKER_COLOR = 0x38bdf8
const HAND_HINT_OPEN_COLOR = new THREE.Color(0x7dd3fc)
const HAND_HINT_ACTIVE_COLOR = new THREE.Color(0xf97316)
const HAND_HINT_SECONDARY_ACTIVE_COLOR = new THREE.Color(0xfb7185)
const HAND_HINT_MARKER_RADIUS_M = 0.009
const PINCH_CLOSE_DISTANCE_M = 0.018
const PINCH_RELEASE_DISTANCE_M = 0.055

const createSupportState = (): XRSupportState => ({ ar: false, vr: false })

export class WebXRManager {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly controllers: THREE.Group[]
  private readonly controllerGrips: THREE.Group[]
  private readonly hands: THREE.Group[]
  private readonly handDebugMarkers: XRHandDebugMarkers[]
  private readonly sessionListeners: SessionEventListener[] = []
  private readonly activeInputListeners: ActiveInputListener[] = []
  private readonly hudCanvas: HTMLCanvasElement
  private readonly hudContext: CanvasRenderingContext2D
  private readonly hudTexture: THREE.CanvasTexture
  private readonly hudMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private readonly worldPointA = new THREE.Vector3()
  private readonly worldPointB = new THREE.Vector3()

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
    this.handDebugMarkers = []

    const controllerModelFactory = new XRControllerModelFactory()
    const handModelFactory = new XRHandModelFactory()

    for (let index = 0; index < MAX_CONTROLLER_COUNT; index += 1) {
      const controller = this.renderer.xr.getController(index)
      const grip = this.renderer.xr.getControllerGrip(index)
      const hand = this.renderer.xr.getHand(index)

      grip.add(controllerModelFactory.createControllerModel(grip))
      hand.add(handModelFactory.createHandModel(hand, 'mesh'))
      hand.add(this.createHandMarker())
      const debugMarkers = this.createHandDebugMarkers()
      hand.add(debugMarkers.root)

      this.controllers.push(controller)
      this.controllerGrips.push(grip)
      this.hands.push(hand)
      this.handDebugMarkers.push(debugMarkers)

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
      new THREE.TorusGeometry(0.025, 0.0018, 10, 28),
      new THREE.MeshBasicMaterial({
        color: HAND_MARKER_COLOR,
        transparent: true,
        opacity: 0.65,
        depthTest: false,
        depthWrite: false,
      }),
    )
    marker.rotation.x = Math.PI / 2
    marker.position.set(0, 0, -0.015)
    marker.renderOrder = 90
    return marker
  }

  private createHandTipMarker(size = HAND_HINT_MARKER_RADIUS_M) {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(size, 12, 12),
      new THREE.MeshBasicMaterial({
        color: HAND_HINT_OPEN_COLOR.clone(),
        transparent: true,
        opacity: 0.7,
        depthTest: false,
        depthWrite: false,
      }),
    )
    marker.visible = false
    marker.renderOrder = 95
    return marker
  }

  private createHandDebugMarkers(): XRHandDebugMarkers {
    const root = new THREE.Group()
    const palm = this.createHandTipMarker(0.0135)
    const thumbTip = this.createHandTipMarker()
    const indexTip = this.createHandTipMarker()
    const middleTip = this.createHandTipMarker(0.0075)
    const ringTip = this.createHandTipMarker(0.0075)

    root.add(palm)
    root.add(thumbTip)
    root.add(indexTip)
    root.add(middleTip)
    root.add(ringTip)

    return {
      root,
      palm,
      thumbTip,
      indexTip,
      middleTip,
      ringTip,
    }
  }

  private setTipMarkerVisibility(hand: THREE.Group, marker: THREE.Mesh, node: THREE.Object3D | null) {
    marker.visible = true
    if (node) {
      node.getWorldPosition(this.worldPointA)
      hand.worldToLocal(this.worldPointA)
      marker.position.copy(this.worldPointA)
      return true
    }
    return false
  }

  private setTipMarkerStyle(
    marker: THREE.Mesh,
    activeStrength: number,
    activeColor: THREE.Color,
    tracked = true,
  ) {
    const material = marker.material as THREE.MeshBasicMaterial
    material.color.copy(HAND_HINT_OPEN_COLOR).lerp(activeColor, activeStrength)
    material.opacity = (tracked ? 0.62 : 0.34) + activeStrength * 0.33
    const scale = 0.84 + activeStrength * 0.34
    marker.scale.setScalar(scale)
  }

  private updateHandDebugMarkers() {
    const sources = this.session?.inputSources ?? []
    for (let index = 0; index < MAX_CONTROLLER_COUNT; index += 1) {
      const source = sources[index]
      const handMode = this.inputMode === 'hand'
      const hand = this.hands[index]
      const hasJointTracking = Boolean(this.getHandJointNode(hand, 'wrist') || this.getHandJointNode(hand, 'index-finger-tip'))
      const hasHandTracking = handMode && (Boolean(source?.hand) || hasJointTracking)
      const markers = this.handDebugMarkers[index]
      markers.root.visible = hasHandTracking
      if (!handMode) {
        continue
      }

      const thumbTip = this.getHandJointNode(hand, 'thumb-tip')
      const indexTip = this.getHandJointNode(hand, 'index-finger-tip')
      const middleTip = this.getHandJointNode(hand, 'middle-finger-tip')
      const ringTip = this.getHandJointNode(hand, 'ring-finger-tip')
      const wrist = this.getHandJointNode(hand, 'wrist')

      const hasWrist = this.setTipMarkerVisibility(hand, markers.palm, wrist)
      const hasThumbTip = this.setTipMarkerVisibility(hand, markers.thumbTip, thumbTip)
      const hasIndexTip = this.setTipMarkerVisibility(hand, markers.indexTip, indexTip)
      const hasMiddleTip = this.setTipMarkerVisibility(hand, markers.middleTip, middleTip)
      const hasRingTip = this.setTipMarkerVisibility(hand, markers.ringTip, ringTip)

      const pinchIndex = this.getHandPinchStrength(hand, 'index-finger-tip')
      const pinchMiddle = this.getHandPinchStrength(hand, 'middle-finger-tip')
      const pinchRing = this.getHandPinchStrength(hand, 'ring-finger-tip')
      const tracked = hasHandTracking && (hasWrist || hasThumbTip || hasIndexTip || hasMiddleTip || hasRingTip)
      this.setTipMarkerStyle(
        markers.palm,
        Math.max(pinchIndex, pinchMiddle, pinchRing) * 0.55,
        HAND_HINT_ACTIVE_COLOR,
        tracked,
      )
      this.setTipMarkerStyle(markers.thumbTip, pinchIndex, HAND_HINT_ACTIVE_COLOR, tracked)
      this.setTipMarkerStyle(markers.indexTip, pinchIndex, HAND_HINT_ACTIVE_COLOR, tracked)
      this.setTipMarkerStyle(markers.middleTip, pinchMiddle, HAND_HINT_SECONDARY_ACTIVE_COLOR, tracked)
      this.setTipMarkerStyle(markers.ringTip, pinchRing, HAND_HINT_SECONDARY_ACTIVE_COLOR, tracked)
    }
  }

  private getHandJointNode(hand: THREE.Group, jointName: string) {
    const maybeHand = hand as THREE.Group & { joints?: Record<string, THREE.Object3D> }
    return maybeHand.joints?.[jointName] ?? null
  }

  private getHandPinchStrength(hand: THREE.Group, fingerJointName: string) {
    const thumbTip = this.getHandJointNode(hand, 'thumb-tip')
    const fingerTip = this.getHandJointNode(hand, fingerJointName)
    if (!thumbTip || !fingerTip) {
      return 0
    }
    thumbTip.getWorldPosition(this.worldPointA)
    fingerTip.getWorldPosition(this.worldPointB)
    const distance = this.worldPointA.distanceTo(this.worldPointB)
    const normalized = (PINCH_RELEASE_DISTANCE_M - distance) / (PINCH_RELEASE_DISTANCE_M - PINCH_CLOSE_DISTANCE_M)
    return Math.min(1, Math.max(0, normalized))
  }

  private getHandPinchState(index: number, hasHandTracking: boolean) {
    if (!hasHandTracking) {
      return null
    }
    const hand = this.hands[index]
    return {
      index: this.getHandPinchStrength(hand, 'index-finger-tip'),
      middle: this.getHandPinchStrength(hand, 'middle-finger-tip'),
      ring: this.getHandPinchStrength(hand, 'ring-finger-tip'),
    }
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
      const handMode = this.inputMode === 'hand'
      const hand = this.hands[index]
      const hasJointTracking = Boolean(this.getHandJointNode(hand, 'wrist') || this.getHandJointNode(hand, 'index-finger-tip'))
      const hasHandTracking = Boolean(source?.hand) || hasJointTracking

      this.controllers[index].visible = this.inputMode === 'controller' && hasControllerInput
      this.controllerGrips[index].visible = this.inputMode === 'controller' && hasControllerInput
      this.hands[index].visible = handMode && hasHandTracking
      this.handDebugMarkers[index].root.visible = handMode && hasHandTracking
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

  private getSessionInitCandidates(mode: XRSessionModeType, preferHandTracking = false): XRSessionInit[] {
    if (mode === 'inline') {
      if (preferHandTracking) {
        return [
          { requiredFeatures: ['hand-tracking'] },
          { optionalFeatures: ['hand-tracking'] },
          {},
        ]
      }
      return [
        { optionalFeatures: ['hand-tracking'] },
        {},
      ]
    }

    if (mode === 'immersive-ar') {
      if (preferHandTracking) {
        return [
          {
            requiredFeatures: ['hand-tracking'],
            optionalFeatures: ['local-floor', 'bounded-floor', 'dom-overlay'],
            domOverlay: { root: document.body },
          } as XRSessionInit,
          {
            requiredFeatures: ['hand-tracking'],
            optionalFeatures: ['local-floor', 'bounded-floor'],
          } as XRSessionInit,
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
          optionalFeatures: ['local-floor'],
        },
        {},
      ]
    }

    if (preferHandTracking) {
      return [
        {
          requiredFeatures: ['hand-tracking'],
          optionalFeatures: ['local-floor', 'bounded-floor', 'dom-overlay'],
          domOverlay: { root: document.body },
        } as XRSessionInit,
        {
          requiredFeatures: ['hand-tracking'],
          optionalFeatures: ['local-floor', 'bounded-floor'],
        } as XRSessionInit,
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

  async startSession(mode: XRSessionModeType = 'inline', options: XRSessionStartOptions = {}) {
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

    const initCandidates = this.getSessionInitCandidates(mode, options.preferHandTracking ?? false)
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

  async refreshSessionInputMode(mode: XRInteractionMode) {
    if (mode !== 'hand') {
      return
    }
    if (!this.session || !this.sessionMode || this.sessionMode === 'inline') {
      return
    }
    const hasHandSource = Array.from(this.session.inputSources).some((source) => Boolean(source.hand))
    if (hasHandSource) {
      return
    }

    const currentMode = this.sessionMode
    await this.endSession()
    try {
      await this.startSession(currentMode, { preferHandTracking: true })
    } catch (error) {
      try {
        await this.startSession(currentMode)
      } catch {}
      if (error instanceof Error) {
        throw new Error(`手势模式启动失败：${error.message}`)
      }
      throw new Error('手势模式启动失败，请在 Quest 设置中启用 Hand Tracking 后重试')
    }
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
    this.updateHandDebugMarkers()
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
      const hand = this.hands[index]
      const source = inputSources[index]
      const gamepad = source?.gamepad
      const buttons = gamepad?.buttons.map((button) => button.value) ?? []
      const wrist = this.getHandJointNode(hand, 'wrist')
      const indexTip = this.getHandJointNode(hand, 'index-finger-tip')
      const hasJointTracking = Boolean(wrist || indexTip)
      const hasHandTracking = Boolean(source?.hand) || hasJointTracking
      const trackedNode = hasHandTracking ? hand : controller
      const trackedPosition = new THREE.Vector3()
      const trackedQuaternion = new THREE.Quaternion()

      if (hasHandTracking) {
        if (wrist) {
          wrist.getWorldPosition(trackedPosition)
          wrist.getWorldQuaternion(trackedQuaternion)
        } else if (indexTip) {
          indexTip.getWorldPosition(trackedPosition)
          indexTip.getWorldQuaternion(trackedQuaternion)
        } else {
          trackedNode.getWorldPosition(trackedPosition)
          trackedNode.getWorldQuaternion(trackedQuaternion)
        }
      } else {
        trackedNode.getWorldPosition(trackedPosition)
        trackedNode.getWorldQuaternion(trackedQuaternion)
      }

      states.push({
        index,
        connected: Boolean(source) || hasHandTracking,
        handedness: source?.handedness ?? (index === 0 ? 'left' : 'right'),
        hasHandTracking,
        handPinch: this.getHandPinchState(index, hasHandTracking),
        position: trackedPosition,
        quaternion: trackedQuaternion,
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
    for (const markers of this.handDebugMarkers) {
      const tipMarkers = [markers.palm, markers.thumbTip, markers.indexTip, markers.middleTip, markers.ringTip]
      for (const marker of tipMarkers) {
        marker.geometry.dispose()
        ;(marker.material as THREE.Material).dispose()
      }
    }
  }
}
