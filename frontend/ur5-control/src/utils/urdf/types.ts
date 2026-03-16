export interface UrdfOrigin {
  xyz: [number, number, number]
  rpy: [number, number, number]
}

export interface UrdfGeometry {
  filename: string
  scale: [number, number, number]
}

export interface UrdfVisual {
  origin: UrdfOrigin
  geometry: UrdfGeometry
}

export interface UrdfCollision {
  origin: UrdfOrigin
  geometry: UrdfGeometry
}

export interface UrdfLink {
  name: string
  visuals: UrdfVisual[]
  collisions: UrdfCollision[]
}

export interface UrdfLimit {
  lower: number
  upper: number
}

export interface UrdfJoint {
  name: string
  type: string
  parent: string
  child: string
  origin: UrdfOrigin
  axis: [number, number, number]
  limit?: UrdfLimit
}

export interface UrdfRobot {
  name: string
  links: UrdfLink[]
  joints: UrdfJoint[]
}
