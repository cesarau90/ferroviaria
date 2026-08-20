import express, { NextFunction, Request, Response } from 'express'
import cors from 'cors'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { Server } from 'socket.io'

const PORT = Number(process.env.PORT || 3001)
const JWT_SECRET = process.env.JWT_SECRET || 'railguard-demo-local-secret'
const DB_PATH = process.env.DATABASE_PATH || 'railguard.db'
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(origin => origin.trim())
const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA foreign_keys = ON')

type UserToken = { id: number; email: string; role: 'ADMIN' | 'OPERATOR' | 'VIEWER'; name: string }
type Wagon = Record<string, any>

function iso() { return new Date().toISOString() }
function id(prefix: string, value: number) { return `${prefix}-${String(value).padStart(3, '0')}` }
function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = (d: number) => d * Math.PI / 180
  const R = 6371000, dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
export function isInsideGeofence(currentLat: number, currentLng: number, destinationLat: number, destinationLng: number, radiusMeters: number) {
  return haversine(currentLat, currentLng, destinationLat, destinationLng) <= radiusMeters
}

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS trips (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, origin TEXT NOT NULL, destination TEXT NOT NULL, product TEXT NOT NULL, departure TEXT NOT NULL, origin_lat REAL NOT NULL, origin_lng REAL NOT NULL, dest_lat REAL NOT NULL, dest_lng REAL NOT NULL, geofence_radius INTEGER NOT NULL, status TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS wagons (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS devices (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS trip_wagons (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id INTEGER NOT NULL, wagon_id INTEGER NOT NULL, device_id INTEGER NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL, speed REAL NOT NULL DEFAULT 0, battery INTEGER NOT NULL, lock_status TEXT NOT NULL, door_status TEXT NOT NULL, tamper INTEGER NOT NULL DEFAULT 0, online INTEGER NOT NULL DEFAULT 1, off_route INTEGER NOT NULL DEFAULT 0, last_seen TEXT NOT NULL, FOREIGN KEY(trip_id) REFERENCES trips(id), FOREIGN KEY(wagon_id) REFERENCES wagons(id), FOREIGN KEY(device_id) REFERENCES devices(id), UNIQUE(trip_id,wagon_id), UNIQUE(trip_id,device_id));
    CREATE TABLE IF NOT EXISTS telemetry (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_wagon_id INTEGER NOT NULL, latitude REAL, longitude REAL, speed REAL, battery INTEGER, lock_status TEXT, door_status TEXT, tamper INTEGER, online INTEGER, timestamp TEXT NOT NULL, FOREIGN KEY(trip_wagon_id) REFERENCES trip_wagons(id));
    CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id INTEGER, trip_wagon_id INTEGER, type TEXT NOT NULL, severity TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TEXT NOT NULL, FOREIGN KEY(trip_id) REFERENCES trips(id), FOREIGN KEY(trip_wagon_id) REFERENCES trip_wagons(id));
    CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, user_id INTEGER, action TEXT NOT NULL, trip_id INTEGER, trip_wagon_id INTEGER, result TEXT NOT NULL, reason TEXT, metadata TEXT, FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(trip_id) REFERENCES trips(id), FOREIGN KEY(trip_wagon_id) REFERENCES trip_wagons(id));
    CREATE TABLE IF NOT EXISTS unlock_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT UNIQUE NOT NULL, trip_wagon_id INTEGER NOT NULL, user_id INTEGER NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(trip_wagon_id) REFERENCES trip_wagons(id), FOREIGN KEY(user_id) REFERENCES users(id));
  `)
  if ((db.prepare('SELECT count(*) as c FROM users').get() as any).c) return
  const addUser = db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)')
  addUser.run('Ana Morales', 'admin@railguard.demo', bcrypt.hashSync('Admin123!', 10), 'ADMIN')
  addUser.run('Luis Ortega', 'operator@railguard.demo', bcrypt.hashSync('Operator123!', 10), 'OPERATOR')
  addUser.run('Sofía Reyes', 'viewer@railguard.demo', bcrypt.hashSync('Viewer123!', 10), 'VIEWER')
  const insertWagon = db.prepare('INSERT INTO wagons (code) VALUES (?)'), insertDevice = db.prepare('INSERT INTO devices (code) VALUES (?)')
  for (let i = 1; i <= 30; i++) { insertWagon.run(id('WGN', i)); insertDevice.run(id('DEV', i)) }
  const trip = db.prepare('INSERT INTO trips (code,origin,destination,product,departure,origin_lat,origin_lng,dest_lat,dest_lng,geofence_radius,status,progress,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('TRIP-2026-001', 'Tampico, Tamaulipas', 'Monterrey, Nuevo León', 'Pellet', iso(), 22.2553, -97.8686, 25.6866, -100.3161, 1500, 'ACTIVE', .14, iso())
  const link = db.prepare('INSERT INTO trip_wagons (trip_id,wagon_id,device_id,latitude,longitude,speed,battery,lock_status,door_status,tamper,online,off_route,last_seen) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
  for (let i = 1; i <= 15; i++) link.run(trip.lastInsertRowid, i, i, 22.2553 + i * .001, -97.8686 - i * .001, 54 + (i % 6), 65 + ((i * 7) % 35), 'LOCKED', 'CLOSED', 0, 1, 0, iso())
  audit(null, 'SYSTEM_SEED', Number(trip.lastInsertRowid), null, 'SUCCESS', 'Demo initial data generated')
}
function audit(userId: number | null, action: string, tripId: number | null, tripWagonId: number | null, result: string, reason?: string, metadata?: unknown) {
  db.prepare('INSERT INTO audit_logs (timestamp,user_id,action,trip_id,trip_wagon_id,result,reason,metadata) VALUES (?,?,?,?,?,?,?,?)').run(iso(), userId, action, tripId, tripWagonId, result, reason || null, metadata ? JSON.stringify(metadata) : null)
}
init()

const app = express(); app.use(cors({ origin: allowedOrigins })); app.use(express.json())
const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: allowedOrigins } })
function token(req: Request, res: Response, next: NextFunction) {
  const raw = req.headers.authorization?.replace('Bearer ', '')
  if (!raw) return res.status(401).json({ message: 'Authentication required' })
  try { (req as any).user = jwt.verify(raw, JWT_SECRET) as UserToken; next() } catch { return res.status(401).json({ message: 'Invalid session' }) }
}
function allow(...roles: UserToken['role'][]) { return (req: Request, res: Response, next: NextFunction) => roles.includes((req as any).user.role) ? next() : res.status(403).json({ message: 'Insufficient permission' }) }
function wagonRow(idValue: number): Wagon | undefined {
  return db.prepare(`SELECT tw.*, w.code wagon_code, d.code device_code, t.code trip_code,t.status trip_status,t.dest_lat,t.dest_lng,t.geofence_radius,t.origin,t.destination,t.product,t.progress
  FROM trip_wagons tw JOIN wagons w ON w.id=tw.wagon_id JOIN devices d ON d.id=tw.device_id JOIN trips t ON t.id=tw.trip_id WHERE tw.id=?`).get(idValue) as Wagon | undefined
}
function wagonData(w: Wagon) {
  const geofence = isInsideGeofence(w.latitude, w.longitude, w.dest_lat, w.dest_lng, w.geofence_radius)
  const critical = w.tamper || w.door_status === 'OPEN' || w.off_route || !w.online
  const warning = w.battery < 20
  return { id: w.id, wagonId: w.wagon_code, deviceId: w.device_code, tripId: w.trip_id, tripCode: w.trip_code, latitude: w.latitude, longitude: w.longitude, speed: w.speed, battery: w.battery, lockStatus: w.lock_status, doorStatus: w.door_status, tamper: !!w.tamper, online: !!w.online, offRoute: !!w.off_route, lastSeen: w.last_seen, status: critical ? 'CRITICAL' : warning ? 'WARNING' : 'ONLINE', geofence: geofence ? 'INSIDE_GEOFENCE' : 'OUTSIDE_GEOFENCE' }
}
function alertFor(tripId: number, twId: number, type: string, severity: string, description: string) {
  const open = db.prepare("SELECT id FROM alerts WHERE trip_wagon_id=? AND type=? AND status IN ('ACTIVE','ACKNOWLEDGED')").get(twId, type)
  if (open) return
  const result = db.prepare('INSERT INTO alerts (trip_id,trip_wagon_id,type,severity,description,status,created_at) VALUES (?,?,?,?,?,?,?)').run(tripId, twId, type, severity, description, 'ACTIVE', iso())
  const a = db.prepare('SELECT * FROM alerts WHERE id=?').get(result.lastInsertRowid)
  io.emit('alert:new', a); audit(null, type, tripId, twId, 'ALERT', description)
}
function resolveAlert(twId: number, type: string) { db.prepare("UPDATE alerts SET status='RESOLVED' WHERE trip_wagon_id=? AND type=? AND status IN ('ACTIVE','ACKNOWLEDGED')").run(twId, type) }
function evaluate(w: Wagon) {
  if (w.battery < 20) alertFor(w.trip_id, w.id, 'LOW_BATTERY', 'WARNING', `${w.wagon_code}: batería crítica (${w.battery}%)`); else resolveAlert(w.id, 'LOW_BATTERY')
  if (!w.online) alertFor(w.trip_id, w.id, 'DEVICE_OFFLINE', 'CRITICAL', `${w.wagon_code}: dispositivo sin comunicación`); else resolveAlert(w.id, 'DEVICE_OFFLINE')
  if (w.tamper) alertFor(w.trip_id, w.id, 'TAMPER_DETECTED', 'CRITICAL', `${w.wagon_code}: manipulación detectada`); else resolveAlert(w.id, 'TAMPER_DETECTED')
  if (w.door_status === 'OPEN') alertFor(w.trip_id, w.id, 'UNAUTHORIZED_OPEN', 'CRITICAL', `${w.wagon_code}: compuerta abierta inesperadamente`); else resolveAlert(w.id, 'UNAUTHORIZED_OPEN')
  if (w.off_route) alertFor(w.trip_id, w.id, 'OFF_ROUTE', 'WARNING', `${w.wagon_code}: fuera de la ruta esperada`); else resolveAlert(w.id, 'OFF_ROUTE')
}

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {}; const user = db.prepare('SELECT * FROM users WHERE email=?').get(email) as any
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) return res.status(401).json({ message: 'Correo o contraseña incorrectos' })
  const safe = { id: user.id, email: user.email, role: user.role, name: user.name } as UserToken
  audit(user.id, 'LOGIN', null, null, 'SUCCESS'); res.json({ token: jwt.sign(safe, JWT_SECRET, { expiresIn: '8h' }), user: safe })
})
app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'railguard-api', timestamp: iso() }))
const GEOCODE_USER_AGENT = 'RailGuard-Demo/1.0 (+https://github.com/cesarau90/ferroviaria)'
app.get('/api/geocode', token, async (req, res) => {
  const q = String(req.query.q || '').trim()
  if (q.length < 3) return res.json([])
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=es&q=${encodeURIComponent(q)}`
    const upstream = await fetch(url, { headers: { 'User-Agent': GEOCODE_USER_AGENT } })
    if (!upstream.ok) return res.status(502).json({ message: 'El servicio de ubicaciones no respondió correctamente.' })
    const results = await upstream.json() as any[]
    res.json(results.slice(0, 5).map(r => ({ label: r.display_name as string, lat: Number(r.lat), lng: Number(r.lon) })))
  } catch {
    res.status(502).json({ message: 'No se pudo consultar el servicio de ubicaciones. Intenta nuevamente.' })
  }
})
app.get('/api/dashboard', token, (_req, res) => {
  const wagons = db.prepare("SELECT tw.*,t.dest_lat,t.dest_lng,t.geofence_radius FROM trip_wagons tw JOIN trips t ON t.id=tw.trip_id WHERE t.status='ACTIVE'").all() as Wagon[]
  const activeAlerts = (db.prepare("SELECT count(*) c FROM alerts WHERE status='ACTIVE'").get() as any).c
  const totalWagons = (db.prepare('SELECT count(*) c FROM trip_wagons').get() as any).c
  res.json({
    stats: {
      activeTrips: (db.prepare("SELECT count(*) c FROM trips WHERE status='ACTIVE'").get() as any).c,
      plannedTrips: (db.prepare("SELECT count(*) c FROM trips WHERE status='PLANNED'").get() as any).c,
      arrivedTrips: (db.prepare("SELECT count(*) c FROM trips WHERE status='ARRIVED'").get() as any).c,
      monitoredWagons: wagons.length,
      totalWagons,
      activeAlerts,
      offline: wagons.filter(x => !x.online).length,
      lowBattery: wagons.filter(x => x.battery < 20).length
    },
    recentTrips: db.prepare('SELECT t.*,count(tw.id) wagon_count FROM trips t LEFT JOIN trip_wagons tw ON tw.trip_id=t.id GROUP BY t.id ORDER BY t.id DESC').all()
  })
})
app.get('/api/trips', token, (_req, res) => res.json(db.prepare('SELECT t.*,count(tw.id) wagon_count FROM trips t LEFT JOIN trip_wagons tw ON tw.trip_id=t.id GROUP BY t.id ORDER BY t.id DESC').all()))
app.post('/api/trips', token, allow('ADMIN', 'OPERATOR'), (req, res) => {
  const b = req.body || {}
  const originLat = Number(b.originLat), originLng = Number(b.originLng), destLat = Number(b.destLat), destLng = Number(b.destLng)
  const radius = Number(b.radius), wagonCount = Number(b.wagonCount)
  const errors: string[] = []
  if (!String(b.origin || '').trim()) errors.push('El origen es obligatorio.')
  if (!String(b.destination || '').trim()) errors.push('El destino es obligatorio.')
  if (!String(b.departure || '').trim()) errors.push('La fecha de salida es obligatoria.')
  if (!Number.isFinite(originLat) || !Number.isFinite(originLng)) errors.push('Selecciona un origen válido desde las sugerencias.')
  if (!Number.isFinite(destLat) || !Number.isFinite(destLng)) errors.push('Selecciona un destino válido desde las sugerencias.')
  if (!Number.isFinite(radius) || radius <= 0) errors.push('El radio de geocerca debe ser un número positivo.')
  if (!Number.isInteger(wagonCount) || wagonCount < 1) errors.push('La cantidad de vagones debe ser un entero positivo.')
  if (errors.length) return res.status(400).json({ message: errors.join(' ') })
  const count = Math.max(1, Math.min(30, wagonCount))
  const free = db.prepare('SELECT w.id wagonId,d.id deviceId FROM wagons w JOIN devices d ON d.id=w.id WHERE w.id NOT IN (SELECT wagon_id FROM trip_wagons)').all() as any[]
  if (free.length < count) return res.status(400).json({ message: 'No hay vagones/dispositivos disponibles suficientes.' })
  const next = (db.prepare('SELECT count(*) c FROM trips').get() as any).c + 1
  const trip = db.prepare('INSERT INTO trips (code,origin,destination,product,departure,origin_lat,origin_lng,dest_lat,dest_lng,geofence_radius,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(`TRIP-2026-${String(next).padStart(3,'0')}`, b.origin, b.destination, b.product || 'Pellet', b.departure, originLat, originLng, destLat, destLng, radius, 'PLANNED', iso())
  for (const pair of free.slice(0,count)) db.prepare('INSERT INTO trip_wagons (trip_id,wagon_id,device_id,latitude,longitude,speed,battery,lock_status,door_status,tamper,online,off_route,last_seen) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(trip.lastInsertRowid,pair.wagonId,pair.deviceId,originLat,originLng,0,90,'LOCKED','CLOSED',0,1,0,iso())
  audit((req as any).user.id,'TRIP_CREATED',Number(trip.lastInsertRowid),null,'SUCCESS'); res.status(201).json({ id: trip.lastInsertRowid })
})
app.get('/api/trips/:id', token, (req,res) => { const tripId=Number(req.params.id); const trip = db.prepare('SELECT * FROM trips WHERE id=?').get(tripId); if (!trip) return res.status(404).json({message:'Trip not found'}); const wagons = db.prepare('SELECT id FROM trip_wagons WHERE trip_id=?').all(tripId).map((x:any) => wagonData(wagonRow(x.id)!)); res.json({ trip, wagons, events: db.prepare('SELECT * FROM audit_logs WHERE trip_id=? ORDER BY id DESC LIMIT 20').all(tripId) }) })
app.post('/api/trips/:id/start', token, allow('ADMIN','OPERATOR'), (req,res) => {
  const tripId=Number(req.params.id); const trip=db.prepare('SELECT * FROM trips WHERE id=?').get(tripId) as any
  if(!trip) return res.status(404).json({message:'Trip not found'})
  if(trip.status!=='PLANNED') return res.status(400).json({message:'Solo se pueden iniciar viajes planificados.'})
  db.prepare("UPDATE trips SET status='ACTIVE' WHERE id=?").run(tripId)
  audit((req as any).user.id,'TRIP_STARTED',tripId,null,'SUCCESS')
  io.emit('trip:status',{tripId,status:'ACTIVE'}); io.emit('trip:position',{tripId,progress:trip.progress,status:'ACTIVE'})
  res.json({ok:true})
})
app.post('/api/trips/:id/reset', token, allow('ADMIN','OPERATOR'), (req,res) => {
  const tripId=Number(req.params.id); const trip=db.prepare('SELECT * FROM trips WHERE id=?').get(tripId) as any
  if(!trip) return res.status(404).json({message:'Trip not found'})
  if(trip.status!=='ARRIVED') return res.status(400).json({message:'Solo se pueden reiniciar viajes que ya arribaron.'})
  db.prepare("UPDATE trips SET status='ACTIVE', progress=0 WHERE id=?").run(tripId)
  const wagons=db.prepare('SELECT * FROM trip_wagons WHERE trip_id=?').all(tripId) as any[]
  for(const w of wagons) {
    const offset=(w.wagon_id%5)*.0008
    db.prepare("UPDATE trip_wagons SET latitude=?,longitude=?,speed=0,battery=90,lock_status='LOCKED',door_status='CLOSED',tamper=0,online=1,off_route=0,last_seen=? WHERE id=?")
      .run(trip.origin_lat+offset, trip.origin_lng-offset, iso(), w.id)
    db.prepare('DELETE FROM unlock_requests WHERE trip_wagon_id=?').run(w.id)
  }
  db.prepare("UPDATE alerts SET status='RESOLVED' WHERE trip_id=? AND status IN ('ACTIVE','ACKNOWLEDGED')").run(tripId)
  audit((req as any).user.id,'TRIP_RESET',tripId,null,'SUCCESS','Demostración reiniciada')
  io.emit('trip:status',{tripId,status:'ACTIVE'}); io.emit('trip:position',{tripId,progress:0,status:'ACTIVE'})
  for(const w of wagons) io.emit('wagon:status', wagonData(wagonRow(w.id)!))
  res.json({ok:true})
})
app.get('/api/trips/:id/wagons', token, (req,res) => res.json(db.prepare('SELECT id FROM trip_wagons WHERE trip_id=?').all(Number(req.params.id)).map((x:any)=>wagonData(wagonRow(x.id)!))))
app.get('/api/wagons/:id', token, (req,res) => { const w = wagonRow(Number(req.params.id)); if(!w) return res.status(404).json({message:'Wagon not found'}); res.json({ wagon: wagonData(w), telemetry: db.prepare('SELECT * FROM telemetry WHERE trip_wagon_id=? ORDER BY id DESC LIMIT 30').all(w.id), events: db.prepare('SELECT * FROM audit_logs WHERE trip_wagon_id=? ORDER BY id DESC LIMIT 15').all(w.id) }) })
app.get('/api/wagons/:id/telemetry', token, (req,res) => res.json(db.prepare('SELECT * FROM telemetry WHERE trip_wagon_id=? ORDER BY id DESC LIMIT 50').all(Number(req.params.id))))
function unlockChecks(w: Wagon, user: UserToken) {
  const errors: string[] = []
  if (!['ACTIVE','ARRIVED'].includes(w.trip_status)) errors.push('El viaje no está activo ni arribado.')
  if (!w.online) errors.push('El dispositivo no está en línea.')
  if (!isInsideGeofence(w.latitude,w.longitude,w.dest_lat,w.dest_lng,w.geofence_radius)) errors.push('El vagón no está dentro de la geocerca autorizada.')
  if (!['ADMIN','OPERATOR'].includes(user.role)) errors.push('El usuario no tiene el permiso UNLOCK_WAGON.')
  if (w.lock_status !== 'LOCKED') errors.push('El candado no está bloqueado actualmente.')
  if (w.door_status !== 'CLOSED') errors.push('La compuerta debe permanecer cerrada.')
  if (w.tamper || db.prepare("SELECT id FROM alerts WHERE trip_wagon_id=? AND type='TAMPER_DETECTED' AND status='ACTIVE'").get(w.id)) errors.push('Existe una alerta crítica de manipulación activa.')
  return errors
}
app.post('/api/wagons/:id/request-unlock', token, (req,res) => { const w = wagonRow(Number(req.params.id)), user=(req as any).user as UserToken; if(!w) return res.status(404).json({message:'Wagon not found'}); const errors=unlockChecks(w,user); audit(user.id,'UNLOCK_REQUESTED',w.trip_id,w.id,errors.length?'DENIED':'PENDING',errors.join(' ')); if(errors.length) { io.emit('audit:new',{action:'UNLOCK_DENIED',wagonId:w.wagon_code,reason:errors.join(' ')}); return res.status(400).json({authorized:false,errors}) } const unlockToken=`req_${crypto.randomUUID()}`; db.prepare('INSERT INTO unlock_requests (token,trip_wagon_id,user_id,created_at) VALUES (?,?,?,?)').run(unlockToken,w.id,user.id,iso()); res.json({authorized:true,unlockToken,wagonId:w.wagon_code,tripCode:w.trip_code,location:'Zona autorizada'}) })
app.post('/api/wagons/:id/confirm-unlock', token, (req,res) => {
  const { unlockToken, code } = req.body || {}, user=(req as any).user as UserToken, w=wagonRow(Number(req.params.id)); if(!w) return res.status(404).json({message:'Wagon not found'})
  const request = db.prepare('SELECT * FROM unlock_requests WHERE token=? AND trip_wagon_id=? AND user_id=?').get(unlockToken,w.id,user.id)
  // DEMO ONLY - Replace with real MFA/TOTP provider in production.
  if(!request || code !== '123456') { audit(user.id,'UNLOCK_DENIED',w.trip_id,w.id,'DENIED','MFA demo code invalid'); return res.status(400).json({message:'Código de segundo factor inválido.'}) }
  const errors = unlockChecks(w,user); if(errors.length) { audit(user.id,'UNLOCK_DENIED',w.trip_id,w.id,'DENIED',errors.join(' ')); return res.status(400).json({message:'Las condiciones de seguridad cambiaron.',errors}) }
  db.prepare("UPDATE trip_wagons SET lock_status='UNLOCKED' WHERE id=?").run(w.id); db.prepare('DELETE FROM unlock_requests WHERE id=?').run((request as any).id); audit(user.id,'UNLOCK_AUTHORIZED',w.trip_id,w.id,'SUCCESS','Unlock authorized by MFA'); const updated=wagonData(wagonRow(w.id)!); io.emit('wagon:status',updated); io.emit('unlock:status',{wagonId:w.id,status:'UNLOCKED'}); res.json({ok:true,wagon:updated})
})
app.get('/api/alerts', token, (_req,res) => res.json(db.prepare(`SELECT a.*,w.code wagon_code,d.code device_code,t.code trip_code FROM alerts a LEFT JOIN trip_wagons tw ON tw.id=a.trip_wagon_id LEFT JOIN wagons w ON w.id=tw.wagon_id LEFT JOIN devices d ON d.id=tw.device_id LEFT JOIN trips t ON t.id=a.trip_id ORDER BY a.id DESC LIMIT 100`).all()))
app.post('/api/alerts/:id/acknowledge', token, allow('ADMIN','OPERATOR'), (req,res) => { const alertId=Number(req.params.id); db.prepare("UPDATE alerts SET status='ACKNOWLEDGED' WHERE id=?").run(alertId); audit((req as any).user.id,'ALERT_ACKNOWLEDGED',null,null,'SUCCESS',`Alert ${alertId}`); io.emit('alert:update',{id:alertId,status:'ACKNOWLEDGED'}); res.json({ok:true}) })
app.get('/api/audit', token, (_req,res) => res.json(db.prepare(`SELECT a.*,u.name user_name,w.code wagon_code,d.code device_code,t.code trip_code FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN trip_wagons tw ON tw.id=a.trip_wagon_id LEFT JOIN wagons w ON w.id=tw.wagon_id LEFT JOIN devices d ON d.id=tw.device_id LEFT JOIN trips t ON t.id=a.trip_id ORDER BY a.id DESC LIMIT 150`).all()))
app.post('/api/simulator/event', token, allow('ADMIN','OPERATOR'), (req,res) => { const {tripId,wagonId,event}=req.body || {}; const w=wagonRow(Number(wagonId)); if(!w || w.trip_id!==Number(tripId)) return res.status(404).json({message:'Wagon not found in selected trip'}); let sql=''; switch(event) { case 'LOW_BATTERY': sql='UPDATE trip_wagons SET battery=15 WHERE id=?'; break; case 'OFFLINE': sql='UPDATE trip_wagons SET online=0 WHERE id=?'; break; case 'TAMPER': sql='UPDATE trip_wagons SET tamper=1 WHERE id=?'; break; case 'OPEN_DOOR': sql="UPDATE trip_wagons SET door_status='OPEN' WHERE id=?"; break; case 'OFF_ROUTE': sql='UPDATE trip_wagons SET off_route=1,latitude=latitude+.25,longitude=longitude+.25 WHERE id=?'; break; case 'RESTORE': sql="UPDATE trip_wagons SET battery=85,online=1,tamper=0,door_status='CLOSED',off_route=0 WHERE id=?"; break; case 'MOVE_DESTINATION': db.prepare("UPDATE trips SET progress=.995,status='ARRIVED' WHERE id=?").run(tripId); audit((req as any).user.id,'SIMULATOR_MOVE_DESTINATION',Number(tripId),null,'SUCCESS'); io.emit('trip:position',{tripId:Number(tripId),progress:.995}); return res.json({ok:true}); default: return res.status(400).json({message:'Unknown simulator event'}) } db.prepare(sql).run(w.id); const changed=wagonRow(w.id)!; evaluate(changed); audit((req as any).user.id,`SIMULATOR_${event}`,changed.trip_id,changed.id,'SUCCESS'); const result=wagonData(wagonRow(w.id)!); io.emit('wagon:status',result); io.emit('telemetry:update',result); res.json({ok:true,wagon:result}) })

setInterval(() => {
  const trips = db.prepare("SELECT * FROM trips WHERE status='ACTIVE'").all() as any[]
  for (const trip of trips) {
    const p = Math.min(.995, trip.progress + .006); if (p >= .995) db.prepare("UPDATE trips SET progress=?,status='ARRIVED' WHERE id=?").run(p,trip.id); else db.prepare('UPDATE trips SET progress=? WHERE id=?').run(p,trip.id)
    const activeTrip = db.prepare('SELECT * FROM trips WHERE id=?').get(trip.id) as any; io.emit('trip:position',{tripId:trip.id,progress:p,status:activeTrip.status})
    const wagons=db.prepare('SELECT id FROM trip_wagons WHERE trip_id=?').all(trip.id) as any[]
    for(const item of wagons) { const current=wagonRow(item.id)!; if(!current.online) continue; const offset=(current.wagon_id%5)*.0008; const lat=trip.origin_lat+(trip.dest_lat-trip.origin_lat)*p+offset, lng=trip.origin_lng+(trip.dest_lng-trip.origin_lng)*p-offset; const battery=Math.max(1,current.battery-(Math.random()>.85?1:0)); db.prepare('UPDATE trip_wagons SET latitude=?,longitude=?,speed=?,battery=?,last_seen=? WHERE id=?').run(lat,lng,52+Math.round(Math.random()*10),battery,iso(),current.id); const changed=wagonRow(current.id)!; db.prepare('INSERT INTO telemetry (trip_wagon_id,latitude,longitude,speed,battery,lock_status,door_status,tamper,online,timestamp) VALUES (?,?,?,?,?,?,?,?,?,?)').run(changed.id,changed.latitude,changed.longitude,changed.speed,changed.battery,changed.lock_status,changed.door_status,changed.tamper,changed.online,iso()); evaluate(changed); const data=wagonData(changed); io.emit('telemetry:update',data); io.emit('wagon:status',data) }
  }
}, 3000)

io.on('connection', socket => socket.emit('system:connected',{at:iso()}))
httpServer.listen(PORT, () => console.log(`RailGuard API listening on http://localhost:${PORT}`))
