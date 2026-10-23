import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

const GRAVITY = 2200
const BOUNCE = 0.62
const FRICTION = 0.82
const STOP_SPEED = 12
const SHATTER_SPEED = 1650
const MAX_THROW = 3400
const HUD_SMOOTH = 0.22
const ACC_SAMPLE_MS = 5
const SPINNER_DELAY_MS = 5000
const RESET_AFTER_SPINNER_MS = 1500
/** How quickly the cube eases toward its rigid-body pose */
const FLAT_SETTLE = 10
/** Radians of tilt per px/s of drag velocity */
const TILT_PER_SPEED = 0.00038
const MAX_TILT = 0.62
const YAW_PER_SPEED = 0.00014
/** Angular impulse from throw / fall (rad/s per px/s) */
const THROW_SPIN = 0.0011
/** Extra tip torque while gravity accelerates the fall */
const GRAVITY_TORQUE = 0.00055
const FLIGHT_SPIN_DAMP = 0.45
const REST_SPIN_DAMP = 8

/** Fixed-point with leading zeros, e.g. 0340.5 */
function formatMag(n, intDigits = 4, fracDigits = 1) {
  const sign = n < 0 ? '-' : ''
  const fixed = Math.abs(n).toFixed(fracDigits)
  const [intPart, fracPart] = fixed.split('.')
  return `${sign}${intPart.padStart(intDigits, '0')}.${fracPart}`
}

function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) {
    r = c
    g = x
  } else if (h < 120) {
    r = x
    g = c
  } else if (h < 180) {
    g = c
    b = x
  } else if (h < 240) {
    g = x
    b = c
  } else if (h < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  const toByte = (v) => Math.round((v + m) * 255)
  return (toByte(r) << 16) | (toByte(g) << 8) | toByte(b)
}

function randomShardStyle() {
  const hue = Math.random() * 360
  const sat = 0.5 + Math.random() * 0.45
  const fillL = 0.06 + Math.random() * 0.2
  const edgeL = 0.42 + Math.random() * 0.4
  const opacity = 0.45 + Math.random() * 0.4
  return {
    fill: hslToHex(hue, sat, fillL),
    edge: hslToHex(hue, Math.min(1, sat + 0.1), edgeL),
    opacity,
  }
}

const SHARD_SHAPES = [
  'cube',
  'prism',
  'triangularPrism',
  'tetrahedron',
  'triangularPyramid',
]

/** Regular n-gon area for a polygon inscribed in a circle of radius r. */
function regularPolygonArea(r, n) {
  return 0.5 * n * r * r * Math.sin((2 * Math.PI) / n)
}

/** Circumradius-R regular tetrahedron volume. */
function tetrahedronVolume(R) {
  return ((8 * Math.sqrt(3)) / 27) * R * R * R
}

/**
 * Build a random shard geometry with known volume (pre-scale).
 * Dimensions are order-~1; caller scales so volumes sum to the cube.
 */
function randomShardGeometry() {
  const shape = SHARD_SHAPES[Math.floor(Math.random() * SHARD_SHAPES.length)]

  switch (shape) {
    case 'cube': {
      const s = 0.8 + Math.random() * 0.4
      return { geometry: new THREE.BoxGeometry(s, s, s), volume: s * s * s }
    }
    case 'prism': {
      if (Math.random() < 0.5) {
        const sx = 0.55 + Math.random() * 0.7
        const sy = 0.7 + Math.random() * 0.8
        const sz = 0.45 + Math.random() * 0.55
        return {
          geometry: new THREE.BoxGeometry(sx, sy, sz),
          volume: sx * sy * sz,
        }
      }
      const sides = 5 + Math.floor(Math.random() * 3)
      const radius = 0.35 + Math.random() * 0.2
      const height = 0.7 + Math.random() * 0.55
      return {
        geometry: new THREE.CylinderGeometry(radius, radius, height, sides),
        volume: regularPolygonArea(radius, sides) * height,
      }
    }
    case 'triangularPrism': {
      const radius = 0.35 + Math.random() * 0.2
      const height = 0.75 + Math.random() * 0.5
      return {
        geometry: new THREE.CylinderGeometry(radius, radius, height, 3),
        volume: regularPolygonArea(radius, 3) * height,
      }
    }
    case 'tetrahedron': {
      const R = 0.55 + Math.random() * 0.25
      return {
        geometry: new THREE.TetrahedronGeometry(R),
        volume: tetrahedronVolume(R),
      }
    }
    case 'triangularPyramid': {
      const radius = 0.35 + Math.random() * 0.2
      const height = 0.8 + Math.random() * 0.45
      const baseArea = regularPolygonArea(radius, 3)
      return {
        geometry: new THREE.ConeGeometry(radius, height, 3),
        volume: (1 / 3) * baseArea * height,
      }
    }
    default: {
      const s = 1
      return { geometry: new THREE.BoxGeometry(s, s, s), volume: 1 }
    }
  }
}

function makeShardMesh(targetVolume, fill = 0x111827, edge = 0x22d3ee, opacity = 0.7) {
  const { geometry, volume: baseVolume } = randomShardGeometry()
  const scale = Math.cbrt(targetVolume / Math.max(baseVolume, 1e-8))

  const group = new THREE.Group()
  group.add(
    new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: fill,
        transparent: true,
        opacity,
      })
    )
  )
  group.add(
    new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: edge })
    )
  )
  group.scale.setScalar(scale)

  geometry.computeBoundingBox()
  const bb = geometry.boundingBox
  const extent = Math.max(
    bb.max.x - bb.min.x,
    bb.max.y - bb.min.y,
    bb.max.z - bb.min.z
  )
  const size = extent * scale

  return { mesh: group, size }
}

export default function HeroCube() {
  const [epoch, setEpoch] = useState(0)
  const mountRef = useRef(null)
  const hudRef = useRef(null)
  const velReadoutRef = useRef(null)
  const accReadoutRef = useRef(null)
  const hintRef = useRef(null)
  const spinnerRef = useRef(null)

  useEffect(() => {
    const mount = mountRef.current
    const hud = hudRef.current
    const velEl = velReadoutRef.current
    const accEl = accReadoutRef.current
    const hintEl = hintRef.current
    const spinner = spinnerRef.current

    // Restore layout slot after a shatter reset
    Object.assign(mount.style, {
      display: '',
      position: '',
      left: '',
      top: '',
      width: '100%',
      height: '100%',
      zIndex: '',
      margin: '',
      cursor: 'grab',
      touchAction: 'none',
    })
    spinner.hidden = true

    const w = mount.clientWidth
    const h = mount.clientHeight

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100)
    camera.position.z = 4.5

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(w, h)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)

    const mainFill = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshBasicMaterial({
        color: 0x111827,
        transparent: true,
        opacity: 0.7,
      })
    )
    const mainEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2)),
      new THREE.LineBasicMaterial({ color: 0x22d3ee })
    )
    const innerEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.3 })
    )
    scene.add(mainFill, mainEdges, innerEdges)

    let freed = false
    let dragging = false
    let physics = false
    let shattered = false
    let rigid = false
    let posX = 0
    let posY = 0
    let velX = 0
    let velY = 0
    let accX = 0
    let accY = 0
    let angVelX = 0
    let angVelY = 0
    let angVelZ = 0
    let dispVel = 0
    let dispAcc = 0
    let dragOffsetX = 0
    let dragOffsetY = 0
    let lastPointerT = 0
    let lastAccSampleT = 0
    let accSampleVelX = 0
    let accSampleVelY = 0
    let cubeW = w
    let cubeH = h
    let lastFrameT = performance.now()
    let shardAnimId = 0
    let spinnerTimer = 0
    let resetTimer = 0

    /** @type {{ mesh: THREE.Group, x: number, y: number, vx: number, vy: number, size: number, spinX: number, spinY: number }[]} */
    let shards = []
    let shardLayer = null
    let shardRenderer = null
    let shardScene = null
    let shardCamera = null

    const showHud = () => {
      hud.hidden = false
    }

    const hideHud = () => {
      hud.hidden = true
    }

    const updateHud = ({ refreshAcc = true } = {}) => {
      const speed = Math.hypot(velX, velY)
      dispVel += (speed - dispVel) * HUD_SMOOTH
      velEl.textContent = `v  ${formatMag(dispVel, 4, 1)} px/s`

      if (refreshAcc) {
        const accelKpx = Math.hypot(accX, accY) / 1000
        dispAcc += (accelKpx - dispAcc) * HUD_SMOOTH
        accEl.textContent = `a  ${formatMag(dispAcc, 3, 1)} kpx/s²`
      }

      const warn = speed >= SHATTER_SPEED * 0.72
      const critical = speed >= SHATTER_SPEED
      hud.classList.toggle('cube-throw-hud--warn', warn && !critical)
      hud.classList.toggle('cube-throw-hud--critical', critical)
      hintEl.textContent = critical
        ? 'will shatter on impact'
        : warn
          ? 'near shatter speed'
          : 'hit a wall fast to shatter'

      const pad = 16
      let hx = posX + cubeW + 12
      let hy = posY + 8
      if (hx + 188 > window.innerWidth) hx = posX - 188 - 12
      if (hy < pad) hy = pad
      if (hy + 80 > window.innerHeight) hy = window.innerHeight - 80 - pad
      hud.style.left = `${Math.max(pad, hx)}px`
      hud.style.top = `${hy}px`
    }

    const clampCube = () => {
      if (shattered) return

      const maxX = window.innerWidth - cubeW
      const maxY = window.innerHeight - cubeH
      let hitX = false
      let hitY = false
      let hitFloor = false

      if (posX < 0) {
        posX = 0
        hitX = true
      } else if (posX > maxX) {
        posX = maxX
        hitX = true
      }

      if (posY < 0) {
        posY = 0
        hitY = true
      } else if (posY > maxY) {
        posY = maxY
        hitY = true
        hitFloor = true
      }

      const hitWall = hitX || hitY
      const impactSpeed = Math.hypot(velX, velY)

      mount.style.left = `${posX}px`
      mount.style.top = `${posY}px`

      // Shatter only on viewport impact while in flight, at high enough speed
      if (hitWall && physics && !dragging && impactSpeed >= SHATTER_SPEED) {
        shatter(impactSpeed)
        return
      }

      if (hitX) velX = -velX * BOUNCE
      if (hitY) {
        velY = -velY * BOUNCE
        if (hitFloor) velX *= FRICTION
      }

      if (hitFloor && Math.abs(velY) < STOP_SPEED && Math.abs(velX) < STOP_SPEED) {
        velX = 0
        velY = 0
        physics = false
      }
    }

    const freeCube = () => {
      if (freed) return
      freed = true
      const rect = mount.getBoundingClientRect()
      cubeW = rect.width
      cubeH = rect.height
      posX = rect.left
      posY = rect.top
      Object.assign(mount.style, {
        position: 'fixed',
        left: `${posX}px`,
        top: `${posY}px`,
        width: `${cubeW}px`,
        height: `${cubeH}px`,
        zIndex: '1000',
        margin: '0',
        cursor: 'grabbing',
      })
    }

    const disposeShards = () => {
      if (shardAnimId) cancelAnimationFrame(shardAnimId)
      shardAnimId = 0
      shards.forEach((s) => {
        s.mesh.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose()
          if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose())
            else obj.material.dispose()
          }
        })
      })
      shards = []
      shardRenderer?.dispose()
      shardLayer?.remove()
      shardLayer = null
      shardRenderer = null
      shardScene = null
      shardCamera = null
    }

    const shatter = (speed) => {
      if (shattered) return
      shattered = true
      physics = false
      dragging = false
      hideHud()
      mount.style.display = 'none'
      mount.style.cursor = 'default'
      spinner.hidden = true

      const t = Math.min(1, (speed - SHATTER_SPEED) / (MAX_THROW - SHATTER_SPEED))
      const grid = t < 0.4 ? 2 : t < 0.75 ? 3 : 4
      const count = grid * grid * grid
      // On-screen cube edge (~FOV fit of the BoxGeometry(2,2,2) in the mount)
      const cubeEdge = Math.min(cubeW, cubeH) * 0.52
      const cubeVolume = cubeEdge * cubeEdge * cubeEdge
      const spacing = cubeEdge / grid
      const cx = posX + cubeW / 2
      const cy = posY + cubeH / 2
      const throwAngle = Math.atan2(velY, velX)
      const throwMag = Math.hypot(velX, velY)

      // Random positive weights → volume shares that sum exactly to the cube
      const weights = Array.from({ length: count }, () => 0.35 + Math.random())
      const weightSum = weights.reduce((a, b) => a + b, 0)

      shardLayer = document.createElement('div')
      shardLayer.className = 'cube-shard-layer'
      Object.assign(shardLayer.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '1001',
        pointerEvents: 'none',
      })
      document.body.appendChild(shardLayer)

      shardScene = new THREE.Scene()
      shardCamera = new THREE.OrthographicCamera(
        0,
        window.innerWidth,
        0,
        window.innerHeight,
        -500,
        500
      )
      shardRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      shardRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      shardRenderer.setSize(window.innerWidth, window.innerHeight)
      shardLayer.appendChild(shardRenderer.domElement)

      let shardIndex = 0
      for (let iz = 0; iz < grid; iz++) {
        for (let iy = 0; iy < grid; iy++) {
          for (let ix = 0; ix < grid; ix++) {
            const targetVolume = cubeVolume * (weights[shardIndex] / weightSum)
            const style = randomShardStyle()
            const { mesh, size } = makeShardMesh(
              targetVolume,
              style.fill,
              style.edge,
              style.opacity
            )
            const ox = (ix - (grid - 1) / 2) * spacing
            const oy = (iy - (grid - 1) / 2) * spacing
            const oz = (iz - (grid - 1) / 2) * spacing
            const burst = 0.55 + t * 0.85
            const bx =
              ox * burst * 8 +
              Math.cos(throwAngle) * throwMag * (0.15 + Math.random() * 0.25)
            const by =
              oy * burst * 8 +
              Math.sin(throwAngle) * throwMag * (0.15 + Math.random() * 0.25)

            const sx = cx + ox * 0.35
            const sy = cy + oy * 0.35
            mesh.position.set(sx, sy, oz * 0.02)
            mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0)
            shardScene.add(mesh)

            shards.push({
              mesh,
              x: sx - size / 2,
              y: sy - size / 2,
              vx: bx + (Math.random() - 0.5) * 400,
              vy: by + (Math.random() - 0.5) * 400,
              size,
              spinX: (Math.random() - 0.5) * 8,
              spinY: (Math.random() - 0.5) * 10,
            })
            shardIndex++
          }
        }
      }

      const tickShards = (now) => {
        shardAnimId = requestAnimationFrame(tickShards)
        const dt = Math.min((now - lastFrameT) / 1000, 0.05)
        lastFrameT = now

        for (const s of shards) {
          s.vy += GRAVITY * dt
          s.x += s.vx * dt
          s.y += s.vy * dt

          const maxX = window.innerWidth - s.size
          const maxY = window.innerHeight - s.size

          if (s.x < 0) {
            s.x = 0
            s.vx = -s.vx * BOUNCE
          } else if (s.x > maxX) {
            s.x = maxX
            s.vx = -s.vx * BOUNCE
          }
          if (s.y < 0) {
            s.y = 0
            s.vy = -s.vy * BOUNCE
          } else if (s.y > maxY) {
            s.y = maxY
            s.vy = -s.vy * BOUNCE
            s.vx *= FRICTION
            if (Math.abs(s.vy) < STOP_SPEED && Math.abs(s.vx) < STOP_SPEED) {
              s.vx = 0
              s.vy = 0
              s.spinX *= 0.85
              s.spinY *= 0.85
            }
          }

          s.mesh.position.set(s.x + s.size / 2, s.y + s.size / 2, 0)
          s.mesh.rotation.x += s.spinX * dt
          s.mesh.rotation.y += s.spinY * dt
        }

        shardRenderer.render(shardScene, shardCamera)
      }
      lastFrameT = performance.now()
      tickShards(lastFrameT)

      spinnerTimer = window.setTimeout(() => {
        spinner.hidden = false
        resetTimer = window.setTimeout(() => {
          spinner.hidden = true
          setEpoch((e) => e + 1)
        }, RESET_AFTER_SPINNER_MS)
      }, SPINNER_DELAY_MS)
    }

    const onPointerDown = (e) => {
      if (shattered) return
      e.preventDefault()
      freeCube()
      dragging = true
      physics = false
      rigid = true
      dragOffsetX = e.clientX - posX
      dragOffsetY = e.clientY - posY
      const now = performance.now()
      lastPointerT = now
      lastAccSampleT = now
      velX = 0
      velY = 0
      accSampleVelX = 0
      accSampleVelY = 0
      accX = 0
      accY = 0
      angVelX = 0
      angVelY = 0
      angVelZ = 0
      dispVel = 0
      dispAcc = 0
      showHud()
      updateHud()
      mount.setPointerCapture(e.pointerId)
      mount.style.cursor = 'grabbing'
    }

    const onPointerMove = (e) => {
      if (!dragging || shattered) return
      const now = performance.now()
      const dt = Math.max((now - lastPointerT) / 1000, 1 / 240)
      const nextX = e.clientX - dragOffsetX
      const nextY = e.clientY - dragOffsetY
      const nextVelX = (nextX - posX) / dt
      const nextVelY = (nextY - posY) / dt
      velX = nextVelX
      velY = nextVelY
      posX = nextX
      posY = nextY
      lastPointerT = now
      clampCube()

      // Sample acceleration on a fixed 5ms cadence while dragging
      const accElapsed = now - lastAccSampleT
      if (accElapsed >= ACC_SAMPLE_MS) {
        const dtAcc = accElapsed / 1000
        accX = (velX - accSampleVelX) / dtAcc
        accY = (velY - accSampleVelY) / dtAcc
        accSampleVelX = velX
        accSampleVelY = velY
        lastAccSampleT = now
        updateHud({ refreshAcc: true })
      } else {
        updateHud({ refreshAcc: false })
      }
    }

    const onPointerUp = (e) => {
      if (!dragging || shattered) return
      dragging = false

      let speed = Math.hypot(velX, velY)
      if (speed > MAX_THROW) {
        const s = MAX_THROW / speed
        velX *= s
        velY *= s
        speed = MAX_THROW
      }

      mount.style.cursor = 'grab'
      try {
        mount.releasePointerCapture(e.pointerId)
      } catch {
        /* already released */
      }

      physics = true
      accX = 0
      accY = GRAVITY
      // Seed tumble from the throw so flight carries spin into the fall
      angVelX = velY * THROW_SPIN * 0.55
      angVelY = velX * THROW_SPIN * 0.4
      angVelZ = -velX * THROW_SPIN
    }

    mount.addEventListener('pointerdown', onPointerDown)
    mount.addEventListener('pointermove', onPointerMove)
    mount.addEventListener('pointerup', onPointerUp)
    mount.addEventListener('pointercancel', onPointerUp)

    let animId
    const animate = (now) => {
      animId = requestAnimationFrame(animate)
      if (shattered) return

      const dt = Math.min((now - lastFrameT) / 1000, 0.05)
      lastFrameT = now

      if (physics && !dragging) {
        const oldVx = velX
        const oldVy = velY
        velY += GRAVITY * dt
        posX += velX * dt
        posY += velY * dt
        accX = (velX - oldVx) / dt
        accY = (velY - oldVy) / dt
        clampCube()
        if (physics) updateHud()
        else hideHud()
      }

      if (rigid) {
        if (dragging) {
          // Tip / yaw from drag velocity
          const targetX = THREE.MathUtils.clamp(velY * TILT_PER_SPEED, -MAX_TILT, MAX_TILT)
          const targetZ = THREE.MathUtils.clamp(-velX * TILT_PER_SPEED, -MAX_TILT, MAX_TILT)
          const targetY = THREE.MathUtils.clamp(
            velX * YAW_PER_SPEED,
            -MAX_TILT * 0.55,
            MAX_TILT * 0.55
          )
          const k = 1 - Math.exp(-FLAT_SETTLE * dt)
          mainFill.rotation.x += (targetX - mainFill.rotation.x) * k
          mainFill.rotation.y += (targetY - mainFill.rotation.y) * k
          mainFill.rotation.z += (targetZ - mainFill.rotation.z) * k
          const ki = 1 - Math.exp(-(FLAT_SETTLE * 0.65) * dt)
          innerEdges.rotation.x += (targetX * 0.85 - innerEdges.rotation.x) * ki
          innerEdges.rotation.y += (targetY * 0.85 - innerEdges.rotation.y) * ki
          innerEdges.rotation.z += (targetZ * 0.85 - innerEdges.rotation.z) * ki
        } else if (physics) {
          // Free rigid tumble: throw spin + ongoing gravity / velocity torque
          angVelX += (GRAVITY * GRAVITY_TORQUE + velY * THROW_SPIN * 0.15) * dt
          angVelZ += (-velX * THROW_SPIN * 0.35) * dt
          angVelY += (velX * THROW_SPIN * 0.2) * dt
          const damp = Math.exp(-FLIGHT_SPIN_DAMP * dt)
          angVelX *= damp
          angVelY *= damp
          angVelZ *= damp
          // Soft cap so it doesn't gyro out of control
          const maxSpin = 9
          angVelX = THREE.MathUtils.clamp(angVelX, -maxSpin, maxSpin)
          angVelY = THREE.MathUtils.clamp(angVelY, -maxSpin, maxSpin)
          angVelZ = THREE.MathUtils.clamp(angVelZ, -maxSpin, maxSpin)

          mainFill.rotation.x += angVelX * dt
          mainFill.rotation.y += angVelY * dt
          mainFill.rotation.z += angVelZ * dt
          innerEdges.rotation.x += angVelX * dt * 0.9
          innerEdges.rotation.y += angVelY * dt * 0.9
          innerEdges.rotation.z += angVelZ * dt * 0.9
        } else {
          // At rest — bleed spin and settle face-flat
          const damp = Math.exp(-REST_SPIN_DAMP * dt)
          angVelX *= damp
          angVelY *= damp
          angVelZ *= damp
          mainFill.rotation.x += angVelX * dt
          mainFill.rotation.y += angVelY * dt
          mainFill.rotation.z += angVelZ * dt
          const k = 1 - Math.exp(-FLAT_SETTLE * dt)
          mainFill.rotation.x += (0 - mainFill.rotation.x) * k
          mainFill.rotation.y += (0 - mainFill.rotation.y) * k
          mainFill.rotation.z += (0 - mainFill.rotation.z) * k
          innerEdges.rotation.x += (0 - innerEdges.rotation.x) * k
          innerEdges.rotation.y += (0 - innerEdges.rotation.y) * k
          innerEdges.rotation.z += (0 - innerEdges.rotation.z) * k
        }
      } else {
        mainFill.rotation.x += 0.004
        mainFill.rotation.y += 0.007
        innerEdges.rotation.x -= 0.006
        innerEdges.rotation.y -= 0.009
      }
      mainEdges.rotation.x = mainFill.rotation.x
      mainEdges.rotation.y = mainFill.rotation.y
      mainEdges.rotation.z = mainFill.rotation.z
      renderer.render(scene, camera)
    }
    animate(performance.now())

    const observer = new ResizeObserver(() => {
      if (freed || shattered) return
      const nw = mount.clientWidth
      const nh = mount.clientHeight
      camera.aspect = nw / nh
      camera.updateProjectionMatrix()
      renderer.setSize(nw, nh)
      cubeW = nw
      cubeH = nh
    })
    observer.observe(mount)

    const onWindowResize = () => {
      if (shattered && shardRenderer && shardCamera) {
        shardCamera.right = window.innerWidth
        shardCamera.bottom = window.innerHeight
        shardCamera.updateProjectionMatrix()
        shardRenderer.setSize(window.innerWidth, window.innerHeight)
        return
      }
      if (!freed) return
      clampCube()
    }
    window.addEventListener('resize', onWindowResize)

    return () => {
      cancelAnimationFrame(animId)
      window.clearTimeout(spinnerTimer)
      window.clearTimeout(resetTimer)
      disposeShards()
      spinner.hidden = true
      hideHud()
      observer.disconnect()
      window.removeEventListener('resize', onWindowResize)
      mount.removeEventListener('pointerdown', onPointerDown)
      mount.removeEventListener('pointermove', onPointerMove)
      mount.removeEventListener('pointerup', onPointerUp)
      mount.removeEventListener('pointercancel', onPointerUp)
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement)
      }
    }
  }, [epoch])

  return (
    <>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
      <div ref={hudRef} className="cube-throw-hud" hidden>
        <div className="cube-throw-hud-float">
          <span ref={velReadoutRef} className="cube-throw-hud-line">
            v  0000.0 px/s
          </span>
          <span ref={accReadoutRef} className="cube-throw-hud-line">
            a  000.0 kpx/s²
          </span>
          <span ref={hintRef} className="cube-throw-hud-hint">
            hit a wall fast to shatter
          </span>
        </div>
      </div>
      <div ref={spinnerRef} className="cube-reset-spinner" hidden>
        <div className="cube-reset-spinner-ring" aria-hidden="true" />
        <span className="cube-reset-spinner-label">reforming</span>
      </div>
    </>
  )
}
