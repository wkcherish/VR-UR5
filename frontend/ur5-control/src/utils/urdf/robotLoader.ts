import * as THREE from 'three'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { parseUrdf } from './parser'
import type { UrdfJoint, UrdfLink, UrdfRobot } from './types'

const colladaLoader = new ColladaLoader()
const stlLoader = new STLLoader()

interface JointNode {
  axis: THREE.Vector3
  motionGroup: THREE.Object3D
  limit?: { lower: number; upper: number }
  type: string
}

export interface RobotModel {
  root: THREE.Group
  joints: Map<string, JointNode>
  meshReport: {
    totalLoaded: number
    missingLinks: string[]
  }
}

const toRadiansEuler = (origin: { rpy: [number, number, number] }) =>
  new THREE.Euler(origin.rpy[0], origin.rpy[1], origin.rpy[2], 'XYZ')

const applyOrigin = (target: THREE.Object3D, origin: { xyz: [number, number, number]; rpy: [number, number, number] }) => {
  target.position.set(origin.xyz[0], origin.xyz[1], origin.xyz[2])
  target.rotation.copy(toRadiansEuler(origin))
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

const loadVisualMesh = async (filename: string) => {
  const path = normalizeMeshPath(filename)
  if (path.toLowerCase().endsWith('.dae')) {
    const collada = await colladaLoader.loadAsync(path)
    if (!collada) {
      return null
    }
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
}

const createLinkGroup = async (link: UrdfLink, useCollisionMesh: boolean) => {
  const group = new THREE.Group()
  group.name = link.name
  const preferredMeshes = useCollisionMesh ? link.collisions : link.visuals
  const fallbackMeshes = useCollisionMesh ? link.visuals : link.collisions
  const meshes = preferredMeshes.length > 0 ? preferredMeshes : fallbackMeshes

  let loadedCount = 0
  for (const meshNode of meshes) {
    const model = await loadVisualMesh(meshNode.geometry.filename)
    if (!model) {
      continue
    }
    applyMeshScale(model, meshNode.geometry.scale)
    const meshWrapper = new THREE.Group()
    applyOrigin(meshWrapper, meshNode.origin)
    meshWrapper.add(model)
    group.add(meshWrapper)
    loadedCount += 1
  }

  return { group, loadedCount }
}

const findRootLinkName = (robot: UrdfRobot) => {
  const children = new Set(robot.joints.map((joint) => joint.child))
  return robot.links.find((link) => !children.has(link.name))?.name || robot.links[0]?.name || ''
}

const attachJoint = (
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
  applyOrigin(originGroup, joint.origin)
  originGroup.add(motionGroup)
  motionGroup.add(childNode)
  parentNode.add(originGroup)

  jointNodes.set(joint.name, {
    axis:
      joint.axis[0] === 0 && joint.axis[1] === 0 && joint.axis[2] === 0
        ? new THREE.Vector3(0, 0, 1)
        : new THREE.Vector3(joint.axis[0], joint.axis[1], joint.axis[2]).normalize(),
    motionGroup,
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
