import type {
  UrdfCollision,
  UrdfJoint,
  UrdfLink,
  UrdfMaterial,
  UrdfOrigin,
  UrdfRobot,
  UrdfVisual,
} from './types'

const parseVector = (raw: string | null | undefined): [number, number, number] => {
  if (!raw) {
    return [0, 0, 0]
  }
  const values = raw
    .trim()
    .split(/\s+/)
    .map((value) => Number(value))
  return [values[0] || 0, values[1] || 0, values[2] || 0]
}

const parseScale = (raw: string | null | undefined): [number, number, number] => {
  if (!raw) {
    return [1, 1, 1]
  }
  const values = raw
    .trim()
    .split(/\s+/)
    .map((value) => Number(value))
  return [values[0] || 1, values[1] || 1, values[2] || 1]
}

const parseRgba = (raw: string | null | undefined): [number, number, number, number] | undefined => {
  if (!raw) {
    return undefined
  }
  const values = raw
    .trim()
    .split(/\s+/)
    .map((value) => Number(value))
  const rgba: [number, number, number, number] = [values[0] || 0, values[1] || 0, values[2] || 0, values[3] ?? 1]
  return rgba
}

const parseOrigin = (element: Element | null): UrdfOrigin => {
  if (!element) {
    return { xyz: [0, 0, 0], rpy: [0, 0, 0] }
  }
  return {
    xyz: parseVector(element.getAttribute('xyz')),
    rpy: parseVector(element.getAttribute('rpy')),
  }
}

const parseMaterial = (element: Element): UrdfMaterial | undefined => {
  const materialElement = element.querySelector('material')
  if (!materialElement) {
    return undefined
  }
  const color = parseRgba(materialElement.querySelector('color')?.getAttribute('rgba'))
  const texture = materialElement.querySelector('texture')?.getAttribute('filename') || undefined
  const name = materialElement.getAttribute('name') || undefined
  if (!color && !texture && !name) {
    return undefined
  }
  return { color, texture, name }
}

const parseVisual = (element: Element): UrdfVisual | null => {
  const mesh = element.querySelector('geometry > mesh')
  const filename = mesh?.getAttribute('filename')
  if (!mesh || !filename) {
    return null
  }
  const origin = parseOrigin(element.querySelector('origin'))
  return {
    origin: {
      xyz: [origin.xyz[0], origin.xyz[1], origin.xyz[2]],
      rpy: [origin.rpy[0], origin.rpy[1], origin.rpy[2]],
    },
    geometry: {
      filename,
      scale: parseScale(mesh.getAttribute('scale')),
    },
    material: parseMaterial(element),
  }
}

const parseCollision = (element: Element): UrdfCollision | null => {
  const mesh = element.querySelector('geometry > mesh')
  const filename = mesh?.getAttribute('filename')
  if (!mesh || !filename) {
    return null
  }
  return {
    origin: parseOrigin(element.querySelector('origin')),
    geometry: {
      filename,
      scale: parseScale(mesh.getAttribute('scale')),
    },
  }
}

const parseLink = (element: Element): UrdfLink => {
  const name = element.getAttribute('name') || ''
  const visuals = Array.from(element.querySelectorAll('visual'))
    .map(parseVisual)
    .filter((item): item is UrdfVisual => item !== null)
  const collisions = Array.from(element.querySelectorAll('collision'))
    .map(parseCollision)
    .filter((item): item is UrdfCollision => item !== null)
  return { name, visuals, collisions }
}

const parseJoint = (element: Element): UrdfJoint => {
  const name = element.getAttribute('name') || ''
  const type = element.getAttribute('type') || 'fixed'
  const parent = element.querySelector('parent')?.getAttribute('link') || ''
  const child = element.querySelector('child')?.getAttribute('link') || ''
  const origin = parseOrigin(element.querySelector('origin'))
  const axis = parseVector(element.querySelector('axis')?.getAttribute('xyz'))
  const limitElement = element.querySelector('limit')
  const lower = Number(limitElement?.getAttribute('lower'))
  const upper = Number(limitElement?.getAttribute('upper'))
  const limit =
    Number.isFinite(lower) && Number.isFinite(upper)
      ? { lower, upper }
      : undefined

  return {
    name,
    type,
    parent,
    child,
    origin,
    axis,
    limit,
  }
}

export const parseUrdf = (xml: string): UrdfRobot => {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  const robotElement = document.querySelector('robot')
  const links = Array.from(document.querySelectorAll('robot > link')).map(parseLink)
  const joints = Array.from(document.querySelectorAll('robot > joint')).map(parseJoint)

  return {
    name: robotElement?.getAttribute('name') || 'robot',
    links,
    joints,
  }
}
