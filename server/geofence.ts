export function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = (d: number) => d * Math.PI / 180
  const R = 6371000, dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
export function isInsideGeofence(currentLat: number, currentLng: number, destinationLat: number, destinationLng: number, radiusMeters: number) {
  return haversine(currentLat, currentLng, destinationLat, destinationLng) <= radiusMeters
}
