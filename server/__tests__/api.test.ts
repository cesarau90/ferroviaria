import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Spawn the tsx CLI script directly with `node` (no shell/npx wrapper) so
// `proc.kill()` terminates the actual server process instead of leaving it
// orphaned behind an intermediary shell — which previously left stale
// servers listening on the test port between runs.
const tsxCli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')

const PORT = 3901
const BASE = `http://localhost:${PORT}/api`
let proc: ChildProcess
let dbDir: string

async function waitForHealth() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/health`); if (r.ok) return } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('Server did not become healthy in time')
}

async function login(email: string, password: string) {
  const res = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  return { status: res.status, body: await res.json() as any }
}

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'railguard-test-'))
  proc = spawn(process.execPath, [tsxCli, 'server/index.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), DATABASE_PATH: join(dbDir, 'test.db'), JWT_SECRET: 'test-secret-key-not-for-production', CLIENT_ORIGIN: `http://localhost:${PORT}`, NODE_ENV: 'test' }
  })
  await waitForHealth()
}, 30000)

afterAll(async () => {
  const exited = new Promise<void>(resolve => proc.once('exit', () => resolve()))
  proc.kill()
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))])
  try { rmSync(dbDir, { recursive: true, force: true }) } catch { /* Windows may still hold a brief lock; best-effort cleanup */ }
})

describe('auth', () => {
  it('rejects an unknown email', async () => {
    const { status, body } = await login('nobody@railguard.demo', 'whatever')
    expect(status).toBe(401)
    expect(body.message).toMatch(/incorrectos/)
  })

  it('rejects the correct email with the wrong password', async () => {
    const { status } = await login('operator@railguard.demo', 'not-the-password')
    expect(status).toBe(401)
  })

  it('logs in with valid demo credentials and returns a JWT + user', async () => {
    const { status, body } = await login('operator@railguard.demo', 'Operator123!')
    expect(status).toBe(200)
    expect(typeof body.token).toBe('string')
    expect(body.user).toMatchObject({ email: 'operator@railguard.demo', role: 'OPERATOR' })
  })

  it('locks out an account after 5 failed attempts', async () => {
    const email = 'lockout-test@railguard.demo'
    for (let i = 0; i < 5; i++) await login(email, 'wrong')
    const { status, body } = await login(email, 'wrong')
    expect(status).toBe(429)
    expect(body.message).toMatch(/Demasiados intentos/)
  })
})

describe('trips', () => {
  let operatorToken: string
  let viewerToken: string

  beforeAll(async () => {
    operatorToken = (await login('operator@railguard.demo', 'Operator123!')).body.token
    viewerToken = (await login('viewer@railguard.demo', 'Viewer123!')).body.token
  })

  const validTrip = {
    origin: 'Tampico, Tamaulipas, México', destination: 'Monterrey, Nuevo León, México', product: 'Pellet',
    departure: '2026-09-01T10:00', originLat: 22.2553, originLng: -97.8686, destLat: 25.6866, destLng: -100.3161,
    radius: 1500, wagonCount: 2
  }

  it('requires authentication', async () => {
    const res = await fetch(`${BASE}/trips`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validTrip) })
    expect(res.status).toBe(401)
  })

  it('forbids VIEWER role from creating a trip', async () => {
    const res = await fetch(`${BASE}/trips`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${viewerToken}` }, body: JSON.stringify(validTrip) })
    expect(res.status).toBe(403)
  })

  it('rejects a trip missing coordinates with a clear validation message', async () => {
    const { origin, destination, product, departure, radius, wagonCount } = validTrip
    const res = await fetch(`${BASE}/trips`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatorToken}` }, body: JSON.stringify({ origin, destination, product, departure, radius, wagonCount }) })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.message).toMatch(/origen válido|destino válido/)
  })

  it('creates a trip as OPERATOR and it shows up in the trip list', async () => {
    const res = await fetch(`${BASE}/trips`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatorToken}` }, body: JSON.stringify(validTrip) })
    expect(res.status).toBe(201)
    const { id } = await res.json() as any

    const list = await fetch(`${BASE}/trips`, { headers: { Authorization: `Bearer ${operatorToken}` } })
    const trips = await list.json() as any[]
    const created = trips.find(t => t.id === id)
    expect(created).toBeTruthy()
    expect(created.status).toBe('PLANNED')
    expect(created.wagon_count).toBe(2)
  })

  it('does not create an orphaned trip when requesting more wagons than are available', async () => {
    const before = await (await fetch(`${BASE}/trips`, { headers: { Authorization: `Bearer ${operatorToken}` } })).json() as any[]
    const res = await fetch(`${BASE}/trips`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatorToken}` }, body: JSON.stringify({ ...validTrip, wagonCount: 9999 }) })
    expect(res.status).toBe(400)
    const after = await (await fetch(`${BASE}/trips`, { headers: { Authorization: `Bearer ${operatorToken}` } })).json() as any[]
    expect(after.length).toBe(before.length)
  })
})

describe('alerts', () => {
  let operatorToken: string

  beforeAll(async () => {
    operatorToken = (await login('operator@railguard.demo', 'Operator123!')).body.token
  })

  it('does not duplicate an alert that is acknowledged while its condition persists', async () => {
    // The seeded demo trip (TRIP-2026-001) starts ACTIVE with 15 wagons already assigned.
    const trips = await (await fetch(`${BASE}/trips`, { headers: { Authorization: `Bearer ${operatorToken}` } })).json() as any[]
    const seeded = trips.find(t => t.code === 'TRIP-2026-001')
    expect(seeded).toBeTruthy()
    const wagons = await (await fetch(`${BASE}/trips/${seeded.id}/wagons`, { headers: { Authorization: `Bearer ${operatorToken}` } })).json() as any[]
    const wagon = wagons[0]

    await fetch(`${BASE}/simulator/event`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatorToken}` }, body: JSON.stringify({ tripId: seeded.id, wagonId: wagon.id, event: 'OFF_ROUTE' }) })

    const alertsBefore = await (await fetch(`${BASE}/alerts`, { headers: { Authorization: `Bearer ${operatorToken}` } })).json() as any[]
    const offRoute = alertsBefore.find(a => a.type === 'OFF_ROUTE' && a.trip_wagon_id === wagon.id)
    expect(offRoute).toBeTruthy()
    expect(offRoute.status).toBe('ACTIVE')

    await fetch(`${BASE}/alerts/${offRoute.id}/acknowledge`, { method: 'POST', headers: { Authorization: `Bearer ${operatorToken}` } })

    // Let at least one telemetry tick (every 3s) pass while the wagon is still off-route.
    await new Promise(r => setTimeout(r, 3500))

    const alertsAfter = await (await fetch(`${BASE}/alerts`, { headers: { Authorization: `Bearer ${operatorToken}` } })).json() as any[]
    const offRouteAlertsForWagon = alertsAfter.filter(a => a.type === 'OFF_ROUTE' && a.trip_wagon_id === wagon.id)
    expect(offRouteAlertsForWagon.length).toBe(1)
    expect(offRouteAlertsForWagon[0].status).toBe('ACKNOWLEDGED')
  }, 15000)
})

describe('unlock', () => {
  let operatorToken: string

  beforeAll(async () => {
    operatorToken = (await login('operator@railguard.demo', 'Operator123!')).body.token
  })

  it('denies an unlock request for a wagon outside the destination geofence', async () => {
    const trips = await (await fetch(`${BASE}/trips`, { headers: { Authorization: `Bearer ${operatorToken}` } })).json() as any[]
    const seeded = trips.find(t => t.code === 'TRIP-2026-001')
    const wagons = await (await fetch(`${BASE}/trips/${seeded.id}/wagons`, { headers: { Authorization: `Bearer ${operatorToken}` } })).json() as any[]
    const wagon = wagons.find(w => w.geofence === 'OUTSIDE_GEOFENCE') || wagons[0]

    const res = await fetch(`${BASE}/wagons/${wagon.id}/request-unlock`, { method: 'POST', headers: { Authorization: `Bearer ${operatorToken}` } })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.authorized).toBe(false)
    expect(body.errors.length).toBeGreaterThan(0)
  })

  it('rejects confirm-unlock with a token that does not exist', async () => {
    const trips = await (await fetch(`${BASE}/trips`, { headers: { Authorization: `Bearer ${operatorToken}` } })).json() as any[]
    const seeded = trips.find(t => t.code === 'TRIP-2026-001')
    const wagons = await (await fetch(`${BASE}/trips/${seeded.id}/wagons`, { headers: { Authorization: `Bearer ${operatorToken}` } })).json() as any[]

    const res = await fetch(`${BASE}/wagons/${wagons[0].id}/confirm-unlock`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatorToken}` }, body: JSON.stringify({ unlockToken: 'req_does-not-exist', code: '123456' }) })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.message).toMatch(/no existe o ya fue utilizada/)
  })
})
