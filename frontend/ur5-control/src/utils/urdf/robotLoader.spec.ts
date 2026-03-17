import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import ur5Raw from '../../../public/models/ur5.urdf?raw'
import { parseUrdf } from './parser'
import {
  attachJoint,
  createVisualMeshNode,
  normalizeColladaSceneOrientation,
  toUrdfQuaternion,
  updateRobotJoints,
} from './robotLoader'

const matrixElementsAlmostEqual = (a: THREE.Matrix4, b: THREE.Matrix4, epsilon = 1e-6) =>
  a.elements.every((value, index) => Math.abs(value - b.elements[index]) < epsilon)

const buildExpectedJointTransform = (origin: { xyz: [number, number, number]; rpy: [number, number, number] }, axis: [number, number, number], angle: number) => {
  const originMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(origin.xyz[0], origin.xyz[1], origin.xyz[2]),
    toUrdfQuaternion(origin),
    new THREE.Vector3(1, 1, 1),
  )
  const axisVector =
    axis[0] === 0 && axis[1] === 0 && axis[2] === 0
      ? new THREE.Vector3(0, 0, 1)
      : new THREE.Vector3(axis[0], axis[1], axis[2]).normalize()
  const motionMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 0, 0),
    new THREE.Quaternion().setFromAxisAngle(axisVector, angle),
    new THREE.Vector3(1, 1, 1),
  )
  return originMatrix.multiply(motionMatrix)
}

const buildRuntimeKinematicModel = (xml: string, rootName: string) => {
  const robot = parseUrdf(xml)
  const linkNodes = new Map<string, THREE.Group>(robot.links.map((link) => [link.name, new THREE.Group()]))
  const jointNodes = new Map()
  for (const joint of robot.joints) {
    attachJoint(joint, linkNodes, jointNodes)
  }
  const root = new THREE.Group()
  root.add(linkNodes.get(rootName)!)
  const model = {
    root,
    joints: jointNodes,
    meshReport: { totalLoaded: 0, missingLinks: [] as string[] },
  }
  return { robot, linkNodes, model, root }
}

describe('URDF visual origin flow', () => {
  it('parses each visual origin independently without assigning transform to link', () => {
    const xml = `
      <robot name="demo">
        <link name="arm">
          <visual>
            <origin xyz="0.1 0.2 0.3" rpy="0.4 0.5 0.6" />
            <geometry><mesh filename="./visual/a.dae" /></geometry>
          </visual>
          <visual>
            <origin xyz="-0.3 0.0 1.2" rpy="-0.1 0.0 3.14" />
            <geometry><mesh filename="./visual/b.dae" scale="2 2 2" /></geometry>
          </visual>
        </link>
      </robot>
    `
    const robot = parseUrdf(xml)
    expect(robot.links).toHaveLength(1)
    expect(robot.links[0].visuals).toHaveLength(2)
    expect(robot.links[0].visuals[0].origin).toEqual({
      xyz: [0.1, 0.2, 0.3],
      rpy: [0.4, 0.5, 0.6],
    })
    expect(robot.links[0].visuals[1].origin).toEqual({
      xyz: [-0.3, 0, 1.2],
      rpy: [-0.1, 0, 3.14],
    })
    expect('origin' in robot.links[0]).toBe(false)
  })

  it('applies visual.origin on mesh node while keeping link as pure container', () => {
    const link = new THREE.Group()
    link.name = 'arm_link'
    const visualNode = createVisualMeshNode({
      xyz: [0.12, -0.34, 0.56],
      rpy: [0.78, -0.91, 1.02],
    })
    const model = new THREE.Mesh()
    visualNode.add(model)
    link.add(visualNode)
    link.updateMatrixWorld(true)

    expect(visualNode.position.x).toBeCloseTo(0.12)
    expect(visualNode.position.y).toBeCloseTo(-0.34)
    expect(visualNode.position.z).toBeCloseTo(0.56)
    const expectedOrientation = toUrdfQuaternion({
      rpy: [0.78, -0.91, 1.02],
    })
    expect(visualNode.quaternion.angleTo(expectedOrientation)).toBeLessThan(1e-6)
    expect(link.position.toArray()).toEqual([0, 0, 0])
    expect(link.rotation.x).toBe(0)
    expect(link.rotation.y).toBe(0)
    expect(link.rotation.z).toBe(0)

    const worldPosition = new THREE.Vector3()
    model.getWorldPosition(worldPosition)
    expect(worldPosition.x).toBeCloseTo(0.12)
    expect(worldPosition.y).toBeCloseTo(-0.34)
    expect(worldPosition.z).toBeCloseTo(0.56)
  })

  it('normalizes Collada Z_UP auto-rotation for URDF kinematic consistency', () => {
    const scene = new THREE.Group()
    scene.rotation.set(-Math.PI / 2, 0, 0)
    normalizeColladaSceneOrientation(scene)
    expect(scene.rotation.x).toBeCloseTo(0)
    expect(scene.rotation.y).toBeCloseTo(0)
    expect(scene.rotation.z).toBeCloseTo(0)
  })

  it('keeps parent-child transforms consistent across multiple poses', () => {
    const xml = `
      <robot name="chain">
        <link name="base" />
        <link name="l1" />
        <link name="l2" />
        <joint name="j1" type="revolute">
          <parent link="base" />
          <child link="l1" />
          <origin xyz="0.3 0.2 0.1" rpy="0.2 -0.3 0.4" />
          <axis xyz="0 0 1" />
          <limit lower="-3.14" upper="3.14" />
        </joint>
        <joint name="j2" type="revolute">
          <parent link="l1" />
          <child link="l2" />
          <origin xyz="0.4 -0.2 0.5" rpy="-0.5 0.1 0.2" />
          <axis xyz="0 1 0" />
          <limit lower="-3.14" upper="3.14" />
        </joint>
      </robot>
    `
    const robot = parseUrdf(xml)
    const linkNodes = new Map<string, THREE.Group>(robot.links.map((link) => [link.name, new THREE.Group()]))
    const jointNodes = new Map()
    for (const joint of robot.joints) {
      attachJoint(joint, linkNodes, jointNodes)
    }

    const root = new THREE.Group()
    root.add(linkNodes.get('base')!)
    const model = {
      root,
      joints: jointNodes,
      meshReport: { totalLoaded: 0, missingLinks: [] as string[] },
    }

    const poses = [
      { j1: 0, j2: 0 },
      { j1: 0.3, j2: -0.4 },
      { j1: -1.1, j2: 0.8 },
      { j1: 1.57, j2: -1.2 },
      { j1: -2.2, j2: 2.0 },
    ]

    for (const pose of poses) {
      updateRobotJoints(model, { j1: pose.j1, j2: pose.j2 })
      root.updateMatrixWorld(true)
      for (const joint of robot.joints) {
        const parent = linkNodes.get(joint.parent)!
        const child = linkNodes.get(joint.child)!
        const observed = new THREE.Matrix4().copy(parent.matrixWorld).invert().multiply(child.matrixWorld)
        const angle = joint.name === 'j1' ? pose.j1 : pose.j2
        const expected = buildExpectedJointTransform(joint.origin, joint.axis, angle)
        expect(matrixElementsAlmostEqual(observed, expected, 1e-5)).toBe(true)
      }
    }
  })

  it('keeps UR5 kinematic chain continuous across multi-joint poses', () => {
    const xml = `
      <robot name="ur5_kinematic">
        <link name="base_link" />
        <link name="base_link_inertia" />
        <link name="shoulder_link" />
        <link name="upper_arm_link" />
        <link name="forearm_link" />
        <link name="wrist_1_link" />
        <link name="wrist_2_link" />
        <link name="wrist_3_link" />
        <joint name="base_link-base_link_inertia" type="fixed">
          <parent link="base_link" />
          <child link="base_link_inertia" />
          <origin rpy="0 0 3.141592653589793" xyz="0 0 0" />
        </joint>
        <joint name="shoulder_pan_joint" type="revolute">
          <parent link="base_link_inertia" />
          <child link="shoulder_link" />
          <origin rpy="0 0 0" xyz="0 0 0.089159" />
          <axis xyz="0 0 1" />
          <limit lower="-6.283185307179586" upper="6.283185307179586" />
        </joint>
        <joint name="shoulder_lift_joint" type="revolute">
          <parent link="shoulder_link" />
          <child link="upper_arm_link" />
          <origin rpy="1.570796327 0 0" xyz="0 0 0" />
          <axis xyz="0 0 1" />
          <limit lower="-6.283185307179586" upper="6.283185307179586" />
        </joint>
        <joint name="elbow_joint" type="revolute">
          <parent link="upper_arm_link" />
          <child link="forearm_link" />
          <origin rpy="0 0 0" xyz="-0.425 0 0" />
          <axis xyz="0 0 1" />
          <limit lower="-3.141592653589793" upper="3.141592653589793" />
        </joint>
        <joint name="wrist_1_joint" type="revolute">
          <parent link="forearm_link" />
          <child link="wrist_1_link" />
          <origin rpy="0 0 0" xyz="-0.39225 0 0.10915" />
          <axis xyz="0 0 1" />
          <limit lower="-6.283185307179586" upper="6.283185307179586" />
        </joint>
        <joint name="wrist_2_joint" type="revolute">
          <parent link="wrist_1_link" />
          <child link="wrist_2_link" />
          <origin rpy="1.570796327 0 0" xyz="0 -0.09465 -1.941303950897609e-11" />
          <axis xyz="0 0 1" />
          <limit lower="-6.283185307179586" upper="6.283185307179586" />
        </joint>
        <joint name="wrist_3_joint" type="revolute">
          <parent link="wrist_2_link" />
          <child link="wrist_3_link" />
          <origin rpy="1.570796326589793 3.141592653589793 3.141592653589793" xyz="0 0.0823 -1.688001216681175e-11" />
          <axis xyz="0 0 1" />
          <limit lower="-6.283185307179586" upper="6.283185307179586" />
        </joint>
      </robot>
    `
    const robot = parseUrdf(xml)
    const linkNodes = new Map<string, THREE.Group>(robot.links.map((link) => [link.name, new THREE.Group()]))
    const jointNodes = new Map()
    for (const joint of robot.joints) {
      attachJoint(joint, linkNodes, jointNodes)
    }
    const root = new THREE.Group()
    root.add(linkNodes.get('base_link')!)
    const model = {
      root,
      joints: jointNodes,
      meshReport: { totalLoaded: 0, missingLinks: [] as string[] },
    }
    const poses = [
      { shoulder_pan_joint: 0, shoulder_lift_joint: -1.57, elbow_joint: 1.57, wrist_1_joint: 0, wrist_2_joint: 0, wrist_3_joint: 0 },
      { shoulder_pan_joint: 0.9, shoulder_lift_joint: -1.1, elbow_joint: 0.8, wrist_1_joint: -0.5, wrist_2_joint: 0.7, wrist_3_joint: -1.2 },
      { shoulder_pan_joint: -2.0, shoulder_lift_joint: 1.2, elbow_joint: -1.4, wrist_1_joint: 2.2, wrist_2_joint: -1.7, wrist_3_joint: 0.6 },
    ]

    for (const pose of poses) {
      updateRobotJoints(model, pose)
      root.updateMatrixWorld(true)
      for (const joint of robot.joints) {
        const parent = linkNodes.get(joint.parent)!
        const child = linkNodes.get(joint.child)!
        const observed = new THREE.Matrix4().copy(parent.matrixWorld).invert().multiply(child.matrixWorld)
        const angle = joint.type === 'revolute' ? pose[joint.name as keyof typeof pose] : 0
        const expected = buildExpectedJointTransform(joint.origin, joint.axis, angle)
        expect(matrixElementsAlmostEqual(observed, expected, 1e-5)).toBe(true)
      }
    }
  })

  it('parses UR5 visual material colors from URDF consistently', () => {
    const robot = parseUrdf(ur5Raw)
    const visualMaterials = robot.links.flatMap((link) => link.visuals.map((visual) => visual.material?.color))
    expect(visualMaterials.length).toBeGreaterThan(0)
    const missingMaterialCount = visualMaterials.filter((color) => !color).length
    expect(missingMaterialCount).toBe(0)
    for (const color of visualMaterials) {
      expect(color?.[0]).toBeCloseTo(0.7)
      expect(color?.[1]).toBeCloseTo(0.7)
      expect(color?.[2]).toBeCloseTo(0.7)
      expect(color?.[3]).toBeCloseTo(1)
    }
  })

  it('matches UR5 parent-child transforms under threshold for multiple poses', () => {
    const { robot, linkNodes, model, root } = buildRuntimeKinematicModel(ur5Raw, 'base_link')
    const poses = [
      {
        shoulder_pan_joint: 0,
        shoulder_lift_joint: -1.57,
        elbow_joint: 1.57,
        wrist_1_joint: 0,
        wrist_2_joint: 0,
        wrist_3_joint: 0,
      },
      {
        shoulder_pan_joint: 1.2,
        shoulder_lift_joint: -1.0,
        elbow_joint: 0.6,
        wrist_1_joint: -0.9,
        wrist_2_joint: 1.1,
        wrist_3_joint: -1.4,
      },
      {
        shoulder_pan_joint: -2.0,
        shoulder_lift_joint: 1.3,
        elbow_joint: -1.8,
        wrist_1_joint: 2.5,
        wrist_2_joint: -2.1,
        wrist_3_joint: 0.8,
      },
    ]
    const translationThreshold = 0.001
    const rotationThresholdRad = (0.1 * Math.PI) / 180
    const diffReport: Array<{ joint: string; pose: number; translationError: number; rotationErrorDeg: number }> = []

    for (const [poseIndex, pose] of poses.entries()) {
      updateRobotJoints(model, pose)
      root.updateMatrixWorld(true)
      for (const joint of robot.joints) {
        const parent = linkNodes.get(joint.parent)!
        const child = linkNodes.get(joint.child)!
        const observed = new THREE.Matrix4().copy(parent.matrixWorld).invert().multiply(child.matrixWorld)
        const angle = joint.type === 'revolute' ? pose[joint.name as keyof typeof pose] : 0
        const expected = buildExpectedJointTransform(joint.origin, joint.axis, angle)
        const observedPos = new THREE.Vector3()
        const expectedPos = new THREE.Vector3()
        const observedQuat = new THREE.Quaternion()
        const expectedQuat = new THREE.Quaternion()
        observed.decompose(observedPos, observedQuat, new THREE.Vector3())
        expected.decompose(expectedPos, expectedQuat, new THREE.Vector3())
        const translationError = observedPos.distanceTo(expectedPos)
        const rotationErrorRad = observedQuat.angleTo(expectedQuat)
        diffReport.push({
          joint: joint.name,
          pose: poseIndex,
          translationError,
          rotationErrorDeg: (rotationErrorRad * 180) / Math.PI,
        })
        expect(translationError).toBeLessThanOrEqual(translationThreshold)
        expect(rotationErrorRad).toBeLessThanOrEqual(rotationThresholdRad)
      }
    }

    expect(diffReport.length).toBeGreaterThan(0)
    console.info('UR5 transform diff report', diffReport)
  })
})
