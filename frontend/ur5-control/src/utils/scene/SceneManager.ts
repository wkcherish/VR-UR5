import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

type RenderHook = () => void

export class SceneManager {
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: THREE.WebGLRenderer
  readonly controls: OrbitControls
  private container: HTMLElement
  private running = false
  private renderHook: RenderHook | null = null

  constructor(container: HTMLElement) {
    this.container = container
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x0b1220)

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000)
    this.camera.position.set(3, 2, 3)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.target.set(0, 0.6, 0)

    this.setupLights()
    this.setupHelpers()
    this.resize()
    this.container.appendChild(this.renderer.domElement)
  }

  private setupLights() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5)
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1)
    directionalLight.position.set(4, 6, 4)
    directionalLight.castShadow = true
    directionalLight.shadow.mapSize.set(2048, 2048)
    directionalLight.shadow.camera.near = 0.5
    directionalLight.shadow.camera.far = 30
    directionalLight.shadow.camera.left = -4
    directionalLight.shadow.camera.right = 4
    directionalLight.shadow.camera.top = 4
    directionalLight.shadow.camera.bottom = -4

    this.scene.add(ambientLight)
    this.scene.add(directionalLight)
  }

  private setupHelpers() {
    this.scene.add(new THREE.AxesHelper(0.4))
    const grid = new THREE.GridHelper(2, 20, 0x334155, 0x1e293b)
    grid.position.y = -0.001
    this.scene.add(grid)
  }

  setRenderHook(hook: RenderHook | null) {
    this.renderHook = hook
  }

  resize() {
    const width = this.container.clientWidth || 1
    const height = this.container.clientHeight || 1
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  private loop = () => {
    this.renderHook?.()
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  start() {
    if (this.running) {
      return
    }
    this.running = true
    this.renderer.setAnimationLoop(this.loop)
  }

  stop() {
    this.renderer.setAnimationLoop(null)
    this.running = false
  }

  dispose() {
    this.stop()
    this.controls.dispose()
    this.renderer.dispose()
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement)
    }
  }
}
