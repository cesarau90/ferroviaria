import { describe, expect, it } from 'vitest'
import { haversine, isInsideGeofence } from '../geofence.js'

describe('isInsideGeofence', () => {
  it('returns true when the point is exactly at the center', () => {
    expect(isInsideGeofence(25.6866, -100.3161, 25.6866, -100.3161, 1500)).toBe(true)
  })

  it('returns true for a point well within the radius', () => {
    // ~110m north of the center (1 arcsecond of latitude is roughly 30m)
    expect(isInsideGeofence(25.6876, -100.3161, 25.6866, -100.3161, 1500)).toBe(true)
  })

  it('returns false for a point clearly outside the radius', () => {
    // Monterrey vs. Tampico — hundreds of km apart, radius is 1500m
    expect(isInsideGeofence(22.2553, -97.8686, 25.6866, -100.3161, 1500)).toBe(false)
  })

  it('treats a point exactly on the radius boundary as inside (<=, not <)', () => {
    const distance = haversine(1, 0, 0, 0)
    expect(isInsideGeofence(1, 0, 0, 0, distance)).toBe(true)
  })

  it('returns false just outside the radius boundary', () => {
    const distance = haversine(1, 0, 0, 0)
    expect(isInsideGeofence(1, 0, 0, 0, distance - 1)).toBe(false)
  })
})
