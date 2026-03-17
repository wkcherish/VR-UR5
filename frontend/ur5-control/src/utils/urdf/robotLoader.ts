import * as THREE from 'three'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { parseUrdf } from './parser'
import type { UrdfJoint, UrdfLink, UrdfRobot } from './types'

const colladaLoader = new ColladaLoader()
const stlLoader = new STLLoader()
const textureLoader = new THREE.TextureLoader()
const halfPi = Math.PI / 2
const epsilon = 1e-4

export interface JointNode {
  axis: THREE.Vector3
  originGroup: THREE.Object3D
  motionGroup: THREE.Object3D
  parentLink: THREE.Object3D
  childLink: THREE.Object3D
  limit?: { lower: number; upper: number }
  type: string
}

interface LinkMeshTransform {
  linkName: string
  meshName: string
  position: [number, number, number]
  rotation: [number, number, number]
}

export interface RobotModel {
  root: THREE.Group
  joints: Map<string, JointNode>
  meshReport: {
    totalLoaded: number
    missingLinks: string[]
  }
}

export const toUrdfQuaternion = (origin: { rpy: [number, number, number] }) => {
  const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), origin.rpy[0])
  const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), origin.rpy[1])
  const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), origin.rpy[2])
  return qz.multiply(qy).multiply(qx)
}

export const applyUrdfOrigin = (target: THREE.Object3D, origin: { xyz: [number, number, number]; rpy: [number, number, number] }) => {
  target.position.set(origin.xyz[0], origin.xyz[1], origin.xyz[2])
  target.quaternion.copy(toUrdfQuaternion(origin))
}

const normalizeMeshPath = (filename: string) => {
  const normalized = filename.replace(/\\/g, '/')
  if (normalized.includes('/visual/')) {
    return `/models/visual/${normalized.split('/visual/').pop()}`
  }
  if (normalized.includes('/collision/')) {
    return `/models/collision/${normalized.split('/collision/').pop()}`
  }
  return `/models/${normalized.replace(/^\.?\//, '')}`
}

const setMeshShadow = (object: THREE.Object3D) => {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true
      child.receiveShadow = true
    }
  })
}

const applyMeshScale = (model: THREE.Object3D, scale: [number, number, number]) => {
  model.scale.set(scale[0], scale[1], scale[2])
}

const getObjectCenterDistance = (object: THREE.Object3D) => {
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) {
    return 0
  }
  const center = new THREE.Vector3()
  box.getCenter(center)
  return center.length()
}

export const normalizeColladaSceneOrientation = (scene: THREE.Object3D) => {
  if (
    Math.abs(scene.rotation.x + halfPi) < epsilon
    && Math.abs(scene.rotation.y) < epsilon
    && Math.abs(scene.rotation.z) < epsilon
  ) {
    scene.rotation.set(0, 0, 0)
  }
}

const loadVisualMesh = async (filename: string) => {
  const path = normalizeMeshPath(filename)
  try {
    if (path.toLowerCase().endsWith('.dae')) {
      const collada = await colladaLoader.loadAsync(path)
      if (!collada) {
        return null
      }
      normalizeColladaSceneOrientation(collada.scene)
      setMeshShadow(collada.scene)
      return collada.scene
    }
    if (path.toLowerCase().endsWith('.stl')) {
      const geometry = await stlLoader.loadAsync(path)
      const material = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.15, roughness: 0.7 })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      return mesh
    }
    return null
  } catch (error) {
    console.warn('URDF mesh load failed', { path, error })
    return null
  }
}

export const createVisualMeshNode = (origin: { xyz: [number, number, number]; rpy: [number, number, number] }) => {
  const visualMesh = new THREE.Mesh()
  applyUrdfOrigin(visualMesh, origin)
  return visualMesh
}

const shouldApplyUrdfMaterial = (meshFilename: string, material: UrdfLink['visuals'][number]['material']) => {
  if (!material) {
    return false
  }
  if (material.texture) {
    return true
  }
  const isDae = meshFilename.toLowerCase().endsWith('.dae')
  if (isDae) {
    return false
  }
  return Boolean(material.color)
}

const applyMaterialToModel = async (model: THREE.Object3D, material: UrdfLink['visuals'][number]['material']) => {
  if (!material) {
    return
  }
  let map: THREE.Texture | null = null
  if (material.texture) {
    const texturePath = normalizeMeshPath(material.texture)
    map = await textureLoader.loadAsync(texturePath).catch(() => null)
  }
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return
    }
    const currentMaterial = Array.isArray(child.material) ? child.material[0] : child.material
    const baseColor = material.color
      ? new THREE.Color(material.color[0], material.color[1], material.color[2])
      : currentMaterial instanceof THREE.MeshStandardMaterial
        ? currentMaterial.color.clone()
        : new THREE.Color(0.7, 0.7, 0.7)
    const opacity = material.color ? material.color[3] : 1
    const nextMaterial = new THREE.MeshStandardMaterial({
      color: baseColor,
      map,
      transparent: opacity < 1,
      opacity,
      metalness: 0.15,
      roughness: 0.7,
    })
    child.material = nextMaterial
  })
}

const readVisualMeshTransform = (mesh: THREE.Object3D) => ({
  position: [mesh.position.x, mesh.position.y, mesh.position.z] as [number, number, number],
  rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z] as [number, number, number],
})

const collectLinkMeshTransforms = (linkNodes: Map<string, THREE.Group>) => {
  const report: LinkMeshTransform[] = []
  for (const [linkName, linkNode] of linkNodes) {
    for (const child of linkNode.children) {
      if (!(child instanceof THREE.Mesh)) {
        continue
      }
      const transform = readVisualMeshTransform(child)
      report.push({
        linkName,
        meshName: child.name || `${linkName}_visual`,
        position: transform.position,
        rotation: transform.rotation,
      })
    }
  }
  return report
}

const fillLinkGroup = async (group: THREE.Group, meshes: Array<UrdfLink['visuals'][number] | UrdfLink['collisions'][number]>) => {
  let loadedCount = 0
  let suspiciousMeshCount = 0

  for (const [index, meshNode] of meshes.entries()) {
    const model = await loadVisualMesh(meshNode.geometry.filename)
    if (!model) {
      continue
    }
    applyMeshScale(model, meshNode.geometry.scale)
    if ('material' in meshNode && shouldApplyUrdfMaterial(meshNode.geometry.filename, meshNode.material)) {
      await applyMaterialToModel(model, meshNode.material)
    }
    const centerDistance = getObjectCenterDistance(model)
    if (centerDistance > 1.2) {
      suspiciousMeshCount += 1
    }
    const visualMesh = createVisualMeshNode(meshNode.origin)
    visualMesh.name = `${group.name || 'link'}_visual_${index}`
    visualMesh.add(model)
    group.add(visualMesh)
    loadedCount += 1
  }

  return { loadedCount, suspiciousMeshCount }
}

const createLinkGroup = async (link: UrdfLink, useCollisionMesh: boolean) => {
  const group = new THREE.Group()
  group.name = link.name
  const preferredMeshes = useCollisionMesh ? link.collisions : link.visuals
  const fallbackMeshes = useCollisionMesh ? link.visuals : link.collisions
  const primary = preferredMeshes.length > 0 ? preferredMeshes : fallbackMeshes

  const primaryResult = await fillLinkGroup(group, primary)
  const shouldFallback = primaryResult.loadedCount === 0 && fallbackMeshes.length > 0
  if (shouldFallback) {
    group.clear()
    const fallbackResult = await fillLinkGroup(group, fallbackMeshes)
    return { group, loadedCount: fallbackResult.loadedCount }
  }

  return { group, loadedCount: primaryResult.loadedCount }
}

const findRootLinkName = (robot: UrdfRobot) => {
  const children = new Set(robot.joints.map((joint) => joint.child))
  return robot.links.find((link) => !children.has(link.name))?.name || robot.links[0]?.name || ''
}

export const attachJoint = (
  joint: UrdfJoint,
  linkNodes: Map<string, THREE.Group>,
  jointNodes: Map<string, JointNode>,
) => {
  const parentNode = linkNodes.get(joint.parent)
  const childNode = linkNodes.get(joint.child)
  if (!parentNode || !childNode) {
    return
  }

  const originGroup = new THREE.Group()
  const motionGroup = new THREE.Group()
  applyUrdfOrigin(originGroup, joint.origin)
  originGroup.add(motionGroup)
  motionGroup.add(childNode)
  parentNode.add(originGroup)

  jointNodes.set(joint.name, {
    originGroup,
    axis:
      joint.axis[0] === 0 && joint.axis[1] === 0 && joint.axis[2] === 0
        ? new THREE.Vector3(0, 0, 1)
        : new THREE.Vector3(joint.axis[0], joint.axis[1], joint.axis[2]).normalize(),
    motionGroup,
    parentLink: parentNode,
    childLink: childNode,
    limit: joint.limit,
    type: joint.type,
  })
}

export const loadRobotFromUrdf = async (url: string, useCollisionMesh = false) => {
  const xml = await fetch(url).then((res) => {
    if (!res.ok) {
      throw new Error(`URDF 加载失败: ${res.status}`)
    }
    return res.text()
  })
  const robot = parseUrdf(xml)
  const linkNodes = new Map<string, THREE.Group>()
  const jointNodes = new Map<string, JointNode>()
  const missingLinks: string[] = []
  let totalLoaded = 0

  for (const link of robot.links) {
    const { group, loadedCount } = await createLinkGroup(link, useCollisionMesh)
    linkNodes.set(link.name, group)
    totalLoaded += loadedCount
    if (loadedCount === 0 && (link.visuals.length > 0 || link.collisions.length > 0)) {
      missingLinks.push(link.name)
    }
  }

  const linkMeshTransforms = collectLinkMeshTransforms(linkNodes)
  if (linkMeshTransforms.length > 0) {
    console.info('URDF link visual mesh transforms', linkMeshTransforms)
  }

  for (const joint of robot.joints) {
    attachJoint(joint, linkNodes, jointNodes)
  }

  const rootName = findRootLinkName(robot)
  const rootLink = linkNodes.get(rootName)
  if (!rootLink) {
    throw new Error('未找到机器人根节点')
  }

  const root = new THREE.Group()
  root.name = robot.name
  root.add(rootLink)
  root.rotation.x = -Math.PI / 2

  return {
    root,
    joints: jointNodes,
    meshReport: {
      totalLoaded,
      missingLinks,
    },
  } satisfies RobotModel
}

export const updateRobotJoints = (model: RobotModel, targetAngles: Record<string, number>) => {
  for (const [jointName, angle] of Object.entries(targetAngles)) {
    const jointNode = model.joints.get(jointName)
    if (!jointNode || jointNode.type !== 'revolute') {
      continue
    }
    const clamped = jointNode.limit
      ? Math.min(Math.max(angle, jointNode.limit.lower), jointNode.limit.upper)
      : angle
    jointNode.motionGroup.quaternion.setFromAxisAngle(jointNode.axis, clamped)
  }
}
