import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { io } from 'socket.io-client'
import { Activity, AlertTriangle, Bell, BookOpen, Box, Calendar, ChevronRight, CircleDot, Cpu, Gauge, ListFilter, Lock, LogOut, Map as MapIcon, MapPin, Menu, Play, Plus, Radio, RotateCcw, ShieldCheck, SlidersHorizontal, Train, Trash2, Unlock, Users, Wifi, X } from 'lucide-react'
import { Circle, CircleMarker, MapContainer, Polyline, Popup, TileLayer } from 'react-leaflet'
import { auth, request, User } from './api'

type Trip={id:number;code:string;origin:string;destination:string;product:string;status:string;progress:number;origin_lat:number;origin_lng:number;dest_lat:number;dest_lng:number;geofence_radius:number;wagon_count:number}
type Wagon={id:number;wagonId:string;deviceId:string;tripId:number;tripCode:string;latitude:number;longitude:number;speed:number;battery:number;lockStatus:string;doorStatus:string;tamper:boolean;online:boolean;offRoute:boolean;lastSeen:string;status:string;geofence:string}
const socket=io(import.meta.env.VITE_SOCKET_URL || undefined,{autoConnect:false,auth:cb=>cb({token:auth.get()})})
socket.on('connect_error',err=>{if(auth.get() && /Authentication required|Invalid session/.test(err.message))window.dispatchEvent(new Event('railguard:unauthorized'))})
const menus=[['/',Gauge,'Dashboard'],['/trips',Train,'Viajes'],['/wagons',Box,'Vagones'],['/devices',Cpu,'Dispositivos'],['/alerts',AlertTriangle,'Alertas'],['/audit',BookOpen,'Bitácora'],['/simulator',SlidersHorizontal,'Simulador'],['/users',Users,'Usuarios']] as const
const colors:Record<string,string>={ONLINE:'bg-emerald-400',WARNING:'bg-amber-400',CRITICAL:'bg-red-500',OFFLINE:'bg-slate-500',ACTIVE:'bg-cyan-400',ARRIVED:'bg-emerald-400',PLANNED:'bg-slate-400',INFO:'bg-cyan-400',ACKNOWLEDGED:'bg-slate-400',RESOLVED:'bg-emerald-400',SUCCESS:'bg-emerald-400',DENIED:'bg-red-500',ALERT:'bg-amber-400',PENDING:'bg-cyan-400',ARCHIVED:'bg-slate-600'}
const statusLabels:Record<string,string>={ONLINE:'EN LÍNEA',WARNING:'ADVERTENCIA',CRITICAL:'CRÍTICO',OFFLINE:'SIN CONEXIÓN',ACTIVE:'ACTIVO',ARRIVED:'ARRIBADO',PLANNED:'PLANIFICADO',INFO:'INFO',ACKNOWLEDGED:'RECONOCIDA',RESOLVED:'RESUELTA',SUCCESS:'ÉXITO',DENIED:'DENEGADO',ALERT:'ALERTA',PENDING:'PENDIENTE',LOCKED:'BLOQUEADO',UNLOCKED:'DESBLOQUEADO',OPEN:'ABIERTA',CLOSED:'CERRADA',LOW_BATTERY:'BATERÍA BAJA',DEVICE_OFFLINE:'DISPOSITIVO SIN CONEXIÓN',TAMPER_DETECTED:'MANIPULACIÓN DETECTADA',UNAUTHORIZED_OPEN:'APERTURA NO AUTORIZADA',OFF_ROUTE:'FUERA DE RUTA',UNAUTHORIZED_ATTEMPT:'INTENTO NO AUTORIZADO',ARCHIVED:'ARCHIVADA'}
function label(value:string){return statusLabels[value]||value.replaceAll('_',' ')}
function Badge({value}:{value:string}) { return <span className={`badge ${colors[value]||'bg-slate-600'} text-slate-950`}><span className="h-1.5 w-1.5 rounded-full bg-current"/>{label(value)}</span> }
function formatTime(value?:string){ return value?new Intl.DateTimeFormat('es-MX',{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(value)):'—' }
type ToastItem={id:number;type:'success'|'error';message:string}
let toastItems:ToastItem[]=[]
let toastListeners:((items:ToastItem[])=>void)[]=[]
let toastSeq=0
function pushToast(type:'success'|'error',message:string){
  const item={id:++toastSeq,type,message}
  toastItems=[...toastItems,item]
  toastListeners.forEach(l=>l(toastItems))
  window.setTimeout(()=>{toastItems=toastItems.filter(t=>t.id!==item.id);toastListeners.forEach(l=>l(toastItems))},5000)
}
const toast={success:(m:string)=>pushToast('success',m),error:(m:string)=>pushToast('error',m)}
function Toaster(){
  const [items,setItems]=useState<ToastItem[]>([])
  useEffect(()=>{toastListeners.push(setItems);return ()=>{toastListeners=toastListeners.filter(l=>l!==setItems)}},[])
  return <div className="fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
    {items.map(t=><div key={t.id} className={`panel flex items-start gap-2 border p-3 text-sm shadow-xl ${t.type==='error'?'border-red-500/40':'border-emerald-500/40'}`}>
      {t.type==='error'?<AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-400"/>:<ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-400"/>}
      <p className={t.type==='error'?'text-red-200':'text-emerald-200'}>{t.message}</p>
    </div>)}
  </div>
}
function TripMap({trip,wagons,compact=false}:{trip:Trip;wagons:Wagon[];compact?:boolean}) {
  const train=wagons[0]
  const route:[[number,number],[number,number]]=[[trip.origin_lat,trip.origin_lng],[trip.dest_lat,trip.dest_lng]]
  const center:[number,number]=train?[train.latitude,train.longitude]:[trip.origin_lat,trip.origin_lng]
  const markerColor=(status:string)=>status==='CRITICAL'?'#ef4444':status==='WARNING'?'#fbbf24':'#22d3ee'
  return <div className="relative h-full min-h-[250px] overflow-hidden rounded-xl">
    <MapContainer center={center} zoom={compact?9:7} scrollWheelZoom className="z-0">
      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
      <Polyline positions={route} pathOptions={{color:'#22d3ee',weight:3,dashArray:'8 8'}}/>
      <Circle center={[trip.origin_lat,trip.origin_lng]} radius={trip.geofence_radius} pathOptions={{color:'#38bdf8',fillColor:'#38bdf8',fillOpacity:.1}}/>
      <Circle center={[trip.dest_lat,trip.dest_lng]} radius={trip.geofence_radius} pathOptions={{color:'#34d399',fillColor:'#34d399',fillOpacity:.12}}/>
      <CircleMarker center={[trip.origin_lat,trip.origin_lng]} radius={7} pathOptions={{color:'#38bdf8',fillColor:'#38bdf8',fillOpacity:1}}><Popup>Origen · {trip.origin}</Popup></CircleMarker>
      <CircleMarker center={[trip.dest_lat,trip.dest_lng]} radius={8} pathOptions={{color:'#34d399',fillColor:'#34d399',fillOpacity:1}}><Popup>Destino · {trip.destination}</Popup></CircleMarker>
      {wagons.map(w=><CircleMarker key={w.id} center={[w.latitude,w.longitude]} radius={5} pathOptions={{color:markerColor(w.status),fillOpacity:1}}>
        <Popup><b>{w.wagonId}</b><br/>{label(w.status)} · {w.battery}% batería<br/>{label(w.lockStatus)} · {label(w.doorStatus)}</Popup>
      </CircleMarker>)}
    </MapContainer>
    {!compact && <div className="absolute bottom-3 left-3 z-[1000] rounded-lg border border-slate-700 bg-slate-950/90 p-2.5 text-[10px] text-slate-300 backdrop-blur">
      <p className="mb-1.5 font-semibold uppercase tracking-wider text-slate-500">Leyenda</p>
      <div className="space-y-1">
        <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-cyan-400"/>Normal</div>
        <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-amber-400"/>Advertencia</div>
        <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-red-500"/>Crítico</div>
        <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-sky-400"/>Origen</div>
        <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-400"/>Destino</div>
      </div>
      <p className="mt-1.5 max-w-[9rem] text-slate-500">Los círculos translúcidos marcan la geocerca.</p>
    </div>}
  </div>
}

function Login({onLogin}:{onLogin:(u:User)=>void}) { const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false); const submit=async(e:FormEvent)=>{e.preventDefault();setBusy(true);setError('');try{const data=await request<{token:string;user:User}>('/auth/login',{method:'POST',body:JSON.stringify({email,password})});auth.set(data.token);onLogin(data.user)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}; return <main className="grid min-h-screen place-items-center bg-[radial-gradient(ellipse_at_top,#12304a,#020617_55%)] p-5"><form onSubmit={submit} className="panel w-full max-w-md p-8"><div className="mb-8 flex items-center gap-3"><div className="rounded-xl bg-cyan-400 p-3 text-slate-950"><Train/></div><div><h1 className="text-2xl font-bold">RailGuard</h1><p className="text-sm text-slate-400">Railway Telemetry & Security Platform</p></div></div><h2 className="mb-1 text-lg font-semibold">Acceso al centro de control</h2><p className="mb-6 text-sm text-slate-400">Usa una cuenta demo para iniciar sesión.</p><label className="label">Correo<input className="input normal-case tracking-normal" value={email} onChange={e=>setEmail(e.target.value)} type="email" autoComplete="username" placeholder="operator@railguard.demo"/></label><label className="label mt-4 block">Contraseña<input className="input normal-case tracking-normal" value={password} onChange={e=>setPassword(e.target.value)} type="password" autoComplete="current-password" placeholder="••••••••"/></label>{error&&<p className="mt-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}<button disabled={busy||!email||!password} className="btn-primary mt-6 w-full">{busy?'Verificando…':'Ingresar al sistema'}<ChevronRight size={16}/></button><p className="mt-5 text-xs leading-5 text-slate-500">Operador: operator@railguard.demo · Operator123!</p></form></main> }

function Shell({user,onLogout}:{user:User;onLogout:()=>void}) {
  const [count,setCount]=useState(0)
  const [menuOpen,setMenuOpen]=useState(false)
  useEffect(()=>{const refresh=()=>request<any[]>('/alerts').then(x=>setCount(x.filter(a=>a.status==='ACTIVE').length)).catch(()=>{}); refresh(); socket.on('alert:new',refresh); socket.on('alert:update',refresh); return()=>{socket.off('alert:new',refresh);socket.off('alert:update',refresh)}},[])
  const navLinks=(onNavigate?:()=>void)=><nav className="space-y-1">{menus.map(([to,Icon,label])=><NavLink key={to} to={to} end={to==='/'} onClick={onNavigate} className={({isActive})=>`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${isActive?'bg-cyan-400 text-slate-950 font-bold':'text-slate-400 hover:bg-slate-900 hover:text-white'}`}><Icon size={18}/>{label}{label==='Alertas'&&count>0&&<span className="ml-auto rounded-full bg-red-500 px-2 py-.5 text-[10px] text-white">{count}</span>}</NavLink>)}</nav>
  return <div className="flex min-h-screen">
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-slate-800 bg-slate-950 p-4 lg:block">
      <div className="mb-8 flex items-center gap-3 px-2"><div className="rounded-lg bg-cyan-400 p-2 text-slate-950"><Train size={22}/></div><div><b>RailGuard</b><p className="text-[10px] tracking-wider text-slate-500">CONTROL PLATFORM</p></div></div>
      {navLinks()}
      <div className="absolute bottom-4 left-4 right-4 rounded-lg border border-slate-800 bg-slate-900 p-3 text-xs text-slate-400"><div className="mb-1 flex items-center gap-2 text-emerald-400"><Wifi size={13}/>Sistema conectado</div><span>Socket.IO telemetría en vivo</span></div>
    </aside>
    {menuOpen && <div className="fixed inset-0 z-40 flex lg:hidden">
      <div className="flex w-72 flex-col border-r border-slate-800 bg-slate-950 p-4">
        <div className="mb-8 flex items-center justify-between px-2">
          <div className="flex items-center gap-3"><div className="rounded-lg bg-cyan-400 p-2 text-slate-950"><Train size={22}/></div><div><b>RailGuard</b><p className="text-[10px] tracking-wider text-slate-500">CONTROL PLATFORM</p></div></div>
          <button onClick={()=>setMenuOpen(false)} aria-label="Cerrar menú" className="rounded p-1 text-slate-400 hover:bg-slate-800"><X/></button>
        </div>
        {navLinks(()=>setMenuOpen(false))}
      </div>
      <button className="flex-1 bg-black/60" aria-label="Cerrar menú" onClick={()=>setMenuOpen(false)}/>
    </div>}
    <div className="min-w-0 flex-1 lg:ml-64">
      <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-slate-800 bg-slate-950/90 px-5 backdrop-blur">
        <div className="flex items-center gap-2 lg:hidden"><button onClick={()=>setMenuOpen(true)} aria-label="Abrir menú" className="mr-1 rounded p-1 text-slate-300 hover:bg-slate-800"><Menu size={20}/></button><Train className="text-cyan-400"/><b>RailGuard</b></div>
        <div className="hidden text-xs text-slate-500 lg:block">OPERATIONS / LIVE MONITORING</div>
        <div className="flex items-center gap-4"><NavLink to="/alerts" className="relative text-slate-400 hover:text-white"><Bell size={19}/>{count>0&&<i className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500"/>}</NavLink><div className="border-l border-slate-800 pl-4 text-right"><p className="text-sm font-semibold">{user.name}</p><p className="text-[10px] tracking-wider text-cyan-400">{user.role}</p></div><button title="Cerrar sesión" onClick={onLogout} className="text-slate-500 hover:text-red-400"><LogOut size={18}/></button></div>
      </header>
      <main className="p-4 sm:p-6"><Routes><Route path="/" element={<Dashboard/>}/><Route path="/trips" element={<Trips user={user}/>}/><Route path="/trips/:id" element={<ControlCenter user={user}/>}/><Route path="/wagons" element={<Wagons user={user}/>}/><Route path="/devices" element={<Devices user={user}/>}/><Route path="/alerts" element={<Alerts user={user}/>}/><Route path="/audit" element={<Audit/>}/><Route path="/simulator" element={<Simulator user={user}/>}/><Route path="/users" element={<UsersPage/>}/><Route path="*" element={<Navigate to="/"/>}/></Routes></main>
    </div>
  </div>
}
function PageTitle({children,action}:{children:React.ReactNode;action?:React.ReactNode}){return <div className="mb-6 flex items-start justify-between gap-3"><div>{children}</div>{action}</div>}
function Dashboard(){
  const [data,setData]=useState<any>()
  const load=()=>request('/dashboard').then(setData).catch(()=>{})
  useEffect(()=>{
    void load()
    const refresh=()=>void load()
    socket.on('trip:status',refresh); socket.on('trip:position',refresh); socket.on('wagon:status',refresh); socket.on('alert:new',refresh); socket.on('alert:update',refresh)
    return ()=>{socket.off('trip:status',refresh);socket.off('trip:position',refresh);socket.off('wagon:status',refresh);socket.off('alert:new',refresh);socket.off('alert:update',refresh)}
  },[])
  const stats=data?.stats
  return <>
    <PageTitle><p className="label">Vista general</p><h1 className="mt-1 text-2xl font-bold">Operational Dashboard</h1><p className="mt-1 text-sm text-slate-400">Estado consolidado de la operación ferroviaria.</p></PageTitle>
    {!data?<div className="grid grid-cols-2 gap-4 lg:grid-cols-5">{[1,2,3,4,5].map(x=><div key={x} className="h-28 animate-pulse rounded-xl bg-slate-800"/>)}</div>:<>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat title="Viajes en curso" value={stats.activeTrips} icon={<Train/>} tint="cyan"/>
        <Stat title="Vagones en viajes activos" value={stats.monitoredWagons} hint={`${stats.totalWagons} registrados en total`} icon={<Radio/>} tint="emerald"/>
        <Stat title="Alertas activas" value={stats.activeAlerts} icon={<AlertTriangle/>} tint="red"/>
        <Stat title="Sin comunicación" value={stats.offline} icon={<Wifi/>} tint="slate"/>
        <Stat title="Baterías bajas" value={stats.lowBattery} icon={<Activity/>} tint="amber"/>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4">
        <MiniStat label="Planificados" value={stats.plannedTrips} hint="Esperando iniciarse"/>
        <MiniStat label="En curso" value={stats.activeTrips} hint="Con telemetría en vivo"/>
        <MiniStat label="Arribados" value={stats.arrivedTrips} hint="Viaje completado; datos conservados"/>
      </div>
      <section className="panel-pad mt-6">
        <div className="mb-4 flex items-center justify-between"><div><p className="label">Operaciones</p><h2 className="text-lg font-semibold">Viajes recientes</h2></div><NavLink to="/trips" className="text-sm text-cyan-400">Ver todos →</NavLink></div>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500"><tr><th className="pb-3">Viaje</th><th className="pb-3">Ruta</th><th className="pb-3">Producto</th><th className="pb-3">Vagones</th><th className="pb-3">Estado</th><th className="pb-3">Progreso</th></tr></thead><tbody>{data.recentTrips.map((t:Trip)=><tr key={t.id} className="border-b border-slate-800/60"><td className="py-4 font-semibold text-cyan-300"><NavLink to={`/trips/${t.id}`}>{t.code}</NavLink></td><td>{t.origin} <span className="text-slate-500">→</span> {t.destination}</td><td>{t.product}</td><td>{t.wagon_count}</td><td><Badge value={t.status}/></td><td className="w-32"><div className="h-1.5 overflow-hidden rounded bg-slate-700"><div className="h-full bg-cyan-400" style={{width:`${Math.round(t.progress*100)}%`}}/></div></td></tr>)}</tbody></table></div>
      </section>
    </>}
  </>
}
function MiniStat({label,value,hint}:{label:string;value:number;hint:string}){return <div className="panel-pad"><p className="text-xl font-bold">{value}</p><p className="mt-1 text-xs font-semibold text-slate-300">{label}</p><p className="mt-0.5 text-[11px] text-slate-500">{hint}</p></div>}
function Stat({title,value,icon,tint,hint}:{title:string;value:number;icon:React.ReactNode;tint:string;hint?:string}){return <div className="panel-pad"><div className={`mb-3 w-fit rounded-lg p-2 text-${tint}-400 bg-${tint}-400/10`}>{icon}</div><p className="text-2xl font-bold">{value}</p><p className="mt-1 text-xs text-slate-400">{title}</p>{hint && <p className="mt-0.5 text-[10px] text-slate-600">{hint}</p>}</div>}
function Trips({user}:{user:User}){
  const [trips,setTrips]=useState<Trip[]>([])
  const [show,setShow]=useState(false)
  const [busyId,setBusyId]=useState<number|null>(null)
  const load=()=>request<Trip[]>('/trips').then(setTrips).catch(()=>{})
  useEffect(()=>{
    void load()
    const refresh=()=>void load()
    socket.on('trip:status',refresh); socket.on('trip:position',refresh)
    return ()=>{socket.off('trip:status',refresh);socket.off('trip:position',refresh)}
  },[])
  const startTrip=async(e:React.MouseEvent,id:number)=>{
    e.preventDefault();e.stopPropagation();setBusyId(id)
    try{await request(`/trips/${id}/start`,{method:'POST'});toast.success('Viaje iniciado. La telemetría en vivo comenzará en segundos.');await load()}
    catch(err){toast.error((err as Error).message)}
    finally{setBusyId(null)}
  }
  const resetTrip=async(e:React.MouseEvent,id:number)=>{
    e.preventDefault();e.stopPropagation()
    if(!window.confirm('¿Reiniciar la demostración de este viaje? Se restablecerá el progreso, la posición, la batería, los candados/compuertas y se resolverán las alertas activas.')) return
    setBusyId(id)
    try{await request(`/trips/${id}/reset`,{method:'POST'});toast.success('Demostración reiniciada correctamente.');await load()}
    catch(err){toast.error((err as Error).message)}
    finally{setBusyId(null)}
  }
  const deleteTrip=async(e:React.MouseEvent,id:number,code:string)=>{
    e.preventDefault();e.stopPropagation()
    if(!window.confirm(`¿Eliminar el viaje ${code}? Esta acción no se puede deshacer.`)) return
    setBusyId(id)
    try{await request(`/trips/${id}`,{method:'DELETE'});toast.success('Viaje eliminado.');await load()}
    catch(err){toast.error((err as Error).message)}
    finally{setBusyId(null)}
  }
  return <>
    <PageTitle action={user.role!=='VIEWER'?<button className="btn-primary" onClick={()=>setShow(true)}><Plus size={16}/>Nuevo viaje</button>:undefined}><p className="label">Planificación</p><h1 className="mt-1 text-2xl font-bold">Viajes ferroviarios</h1><p className="mt-1 text-sm text-slate-400">Gestiona rutas, geocercas y composición de convoyes.</p></PageTitle>
    <div className="grid gap-4 xl:grid-cols-2">{trips.map(t=>
      <NavLink key={t.id} to={`/trips/${t.id}`} className="panel block p-5 transition hover:border-cyan-500/60">
        <div className="flex justify-between"><div><p className="font-bold text-cyan-300">{t.code}</p><h2 className="mt-2 text-lg font-semibold">{t.origin} <span className="text-slate-500">→</span> {t.destination}</h2></div><Badge value={t.status}/></div>
        <div className="mt-5 grid grid-cols-3 gap-3 text-sm"><div><p className="label">Producto</p><p>{t.product}</p></div><div><p className="label">Vagones</p><p>{t.wagon_count}</p></div><div><p className="label">Progreso</p><p>{Math.round(t.progress*100)}%</p></div></div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full bg-cyan-400" style={{width:`${t.progress*100}%`}}/></div>
        {user.role!=='VIEWER' && (t.status==='PLANNED' || t.status==='ARRIVED') && <div className="mt-4 flex justify-end">
          {t.status==='PLANNED' && <button onClick={e=>deleteTrip(e,t.id,t.code)} disabled={busyId===t.id} className="btn-muted"><Trash2 size={14}/>Eliminar</button>}
          {t.status==='PLANNED' && <button onClick={e=>startTrip(e,t.id)} disabled={busyId===t.id} className="btn-primary"><Play size={14}/>{busyId===t.id?'Iniciando…':'Iniciar viaje'}</button>}
          {t.status==='ARRIVED' && <button onClick={e=>resetTrip(e,t.id)} disabled={busyId===t.id} className="btn-muted"><RotateCcw size={14}/>{busyId===t.id?'Reiniciando…':'Reiniciar demostración'}</button>}
        </div>}
      </NavLink>
    )}</div>
    {show&&<TripForm onClose={()=>setShow(false)} done={()=>{setShow(false);void load()}}/>}
  </>
}
type Place={label:string;lat:number;lng:number}
function LocationField({label,placeholder,value,onChange,onSelect,error}:{label:string;placeholder:string;value:string;onChange:(v:string)=>void;onSelect:(p:Place)=>void;error?:string}){
  const [results,setResults]=useState<Place[]>([])
  const [open,setOpen]=useState(false)
  const [loading,setLoading]=useState(false)
  const [searchError,setSearchError]=useState('')
  const boxRef=useRef<HTMLDivElement>(null)
  const lastSelectedRef=useRef<string|null>(null)
  useEffect(()=>{
    if(value.trim().length<3 || value===lastSelectedRef.current){setResults([]);setLoading(false);setSearchError('');return}
    setLoading(true);setSearchError('')
    const controller=new AbortController()
    const timer=window.setTimeout(()=>{
      request<Place[]>(`/geocode?q=${encodeURIComponent(value.trim())}`,{signal:controller.signal})
        .then(r=>{setResults(r);setOpen(true)})
        .catch(e=>{if(!controller.signal.aborted)setSearchError((e as Error).message)})
        .finally(()=>setLoading(false))
    },400)
    return ()=>{window.clearTimeout(timer);controller.abort()}
  },[value])
  useEffect(()=>{
    const onClick=(e:MouseEvent)=>{if(boxRef.current && !boxRef.current.contains(e.target as Node))setOpen(false)}
    document.addEventListener('mousedown',onClick)
    return ()=>document.removeEventListener('mousedown',onClick)
  },[])
  return <div ref={boxRef} className="relative">
    <label className="label">{label}
      <input className="input normal-case tracking-normal" value={value} placeholder={placeholder} autoComplete="off"
        onChange={e=>onChange(e.target.value)} onFocus={()=>results.length>0 && setOpen(true)}/>
    </label>
    {loading && <p className="mt-1 text-xs font-normal normal-case tracking-normal text-slate-500">Buscando ubicaciones…</p>}
    {!loading && searchError && <p className="mt-1 text-xs font-normal normal-case tracking-normal text-red-300">{searchError}</p>}
    {!loading && !searchError && error && <p className="mt-1 text-xs font-normal normal-case tracking-normal text-red-300">{error}</p>}
    {open && results.length>0 && <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
      {results.map((r,i)=><li key={i}><button type="button" className="block w-full px-3 py-2 text-left text-sm normal-case tracking-normal hover:bg-slate-800" onClick={()=>{lastSelectedRef.current=r.label;onSelect(r);setOpen(false)}}>{r.label}</button></li>)}
    </ul>}
  </div>
}
function DateTimeField({label,value,onChange,min,error}:{label:string;value:string;onChange:(v:string)=>void;min:string;error?:string}){
  const [open,setOpen]=useState(false)
  const boxRef=useRef<HTMLDivElement>(null)
  const [datePart,timePart]=value.split('T')
  const minDate=min.split('T')[0]
  const pad=(n:number)=>String(n).padStart(2,'0')
  const seed=datePart?new Date(`${datePart}T00:00`):new Date()
  const [viewYear,setViewYear]=useState(seed.getFullYear())
  const [viewMonth,setViewMonth]=useState(seed.getMonth())
  useEffect(()=>{
    const onClick=(e:MouseEvent)=>{if(boxRef.current && !boxRef.current.contains(e.target as Node))setOpen(false)}
    document.addEventListener('mousedown',onClick)
    return ()=>document.removeEventListener('mousedown',onClick)
  },[])
  const goMonth=(delta:number)=>{const d=new Date(viewYear,viewMonth+delta,1);setViewYear(d.getFullYear());setViewMonth(d.getMonth())}
  const pickDay=(day:number)=>onChange(`${viewYear}-${pad(viewMonth+1)}-${pad(day)}T${timePart||'08:00'}`)
  const pickTime=(t:string)=>{if(datePart)onChange(`${datePart}T${t}`)}
  const daysCount=new Date(viewYear,viewMonth+1,0).getDate()
  const offset=(new Date(viewYear,viewMonth,1).getDay()+6)%7
  const cells=[...Array(offset).fill(null),...Array.from({length:daysCount},(_,i)=>i+1)]
  const rawMonthLabel=new Intl.DateTimeFormat('es-MX',{month:'long',year:'numeric'}).format(new Date(viewYear,viewMonth,1))
  const monthLabel=rawMonthLabel.charAt(0).toUpperCase()+rawMonthLabel.slice(1)
  const display=datePart?new Intl.DateTimeFormat('es-MX',{dateStyle:'long',timeStyle:'short'}).format(new Date(`${datePart}T${timePart||'00:00'}`)):'Selecciona fecha y hora'
  return <div ref={boxRef} className="relative">
    <label className="label">{label}
      <button type="button" onClick={()=>setOpen(o=>!o)} className="input flex w-full items-center justify-between normal-case tracking-normal text-left">
        <span className={datePart?'':'text-slate-500'}>{display}</span>
        <Calendar size={16} className="text-slate-500"/>
      </button>
    </label>
    {error && <p className="mt-1 text-xs font-normal normal-case tracking-normal text-red-300">{error}</p>}
    {open && <div className="panel absolute z-10 mt-1 w-72 bg-slate-900 p-3 shadow-xl">
      <div className="flex items-center justify-between">
        <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-800" onClick={()=>goMonth(-1)}><ChevronRight size={16} className="rotate-180"/></button>
        <p className="text-sm font-semibold">{monthLabel}</p>
        <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-800" onClick={()=>goMonth(1)}><ChevronRight size={16}/></button>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-wider text-slate-500">{['L','M','M','J','V','S','D'].map((d,i)=><span key={i}>{d}</span>)}</div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((day,i)=>{
          if(day===null) return <span key={i}/>
          const iso=`${viewYear}-${pad(viewMonth+1)}-${pad(day)}`
          const disabled=iso<minDate
          const selected=iso===datePart
          return <button key={i} type="button" disabled={disabled} onClick={()=>pickDay(day)} className={`rounded-lg py-1.5 text-xs ${selected?'bg-cyan-400 font-bold text-slate-950':disabled?'cursor-not-allowed text-slate-700':'text-slate-200 hover:bg-slate-800'}`}>{day}</button>
        })}
      </div>
      <label className="label mt-4 block">Hora
        <input type="time" className="input normal-case tracking-normal" value={timePart||''} min={datePart===minDate?min.split('T')[1]:undefined} onChange={e=>pickTime(e.target.value)}/>
      </label>
      <button type="button" className="btn-primary mt-3 w-full" onClick={()=>setOpen(false)}>Listo</button>
    </div>}
  </div>
}
function TripForm({onClose,done}:{onClose:()=>void;done:()=>void}){
  const [origin,setOrigin]=useState('')
  const [originPlace,setOriginPlace]=useState<Place|null>(null)
  const [destination,setDestination]=useState('')
  const [destPlace,setDestPlace]=useState<Place|null>(null)
  const [product,setProduct]=useState('Pellet')
  const minDeparture=useMemo(()=>{const d=new Date();d.setSeconds(0,0);return d.toISOString().slice(0,16)},[])
  const [departure,setDeparture]=useState(()=>{const d=new Date(Date.now()+3600000);d.setSeconds(0,0);return d.toISOString().slice(0,16)})
  const [radius,setRadius]=useState('1500')
  const [pool,setPool]=useState<{wagons:{id:number;code:string}[];devices:{id:number;code:string}[]}>()
  const [picks,setPicks]=useState<Record<number,number>>({})
  const [fieldErrors,setFieldErrors]=useState<Record<string,string>>({})
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  useEffect(()=>{
    Promise.all([request<{id:number;code:string}[]>('/wagons/available'),request<{id:number;code:string}[]>('/devices/available')])
      .then(([wagons,devices])=>setPool({wagons,devices}))
      .catch(()=>{})
  },[])
  const toggleWagon=(wagonId:number)=>setPicks(p=>{
    if(wagonId in p){const rest={...p};delete rest[wagonId];return rest}
    const usedDevices=new Set(Object.values(p))
    const matching=pool?.devices.find(d=>d.id===wagonId && !usedDevices.has(d.id))
    const fallback=pool?.devices.find(d=>!usedDevices.has(d.id))
    const deviceId=(matching||fallback)?.id
    if(deviceId===undefined) return p
    return {...p,[wagonId]:deviceId}
  })
  const setDeviceFor=(wagonId:number,deviceId:number)=>setPicks(p=>({...p,[wagonId]:deviceId}))
  const validate=()=>{
    const errs:Record<string,string>={}
    if(!originPlace || originPlace.label!==origin) errs.origin='Selecciona el origen desde las sugerencias.'
    if(!destPlace || destPlace.label!==destination) errs.destination='Selecciona el destino desde las sugerencias.'
    if(!product.trim()) errs.product='Indica el producto transportado.'
    if(!departure) errs.departure='Indica la fecha y hora de salida.'
    else if(departure<minDeparture) errs.departure='La salida no puede ser anterior al momento actual.'
    const radiusValue=Number(radius)
    if(!radius || !Number.isFinite(radiusValue) || radiusValue<=0) errs.radius='El radio debe ser un número positivo.'
    if(Object.keys(picks).length<1) errs.wagons='Selecciona al menos un vagón con su dispositivo.'
    setFieldErrors(errs)
    return Object.keys(errs).length===0
  }
  const submit=async(e:FormEvent)=>{
    e.preventDefault();setError('')
    if(!validate() || !originPlace || !destPlace) return
    setBusy(true)
    try{
      const assignments=Object.entries(picks).map(([wagonId,deviceId])=>({wagonId:Number(wagonId),deviceId}))
      await request('/trips',{method:'POST',body:JSON.stringify({origin:originPlace.label,destination:destPlace.label,product,departure,originLat:originPlace.lat,originLng:originPlace.lng,destLat:destPlace.lat,destLng:destPlace.lng,radius:Number(radius),assignments})})
      done()
    }catch(e){setError((e as Error).message)}
    finally{setBusy(false)}
  }
  return <div className="fixed inset-0 z-30 grid place-items-center bg-black/70 p-4"><form onSubmit={submit} noValidate className="panel max-h-[90vh] w-full max-w-2xl overflow-auto p-6">
    <div className="mb-5 flex justify-between"><div><h2 className="text-xl font-bold">Crear viaje</h2><p className="text-sm text-slate-400">Busca el origen y destino, y elige qué vagones y dispositivos asignar.</p></div><button type="button" onClick={onClose}><X/></button></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <LocationField label="Origen" placeholder="Ej. Tampico" value={origin} onChange={v=>{setOrigin(v);setOriginPlace(null)}} onSelect={p=>{setOrigin(p.label);setOriginPlace(p)}} error={fieldErrors.origin}/>
      <LocationField label="Destino" placeholder="Ej. Monterrey" value={destination} onChange={v=>{setDestination(v);setDestPlace(null)}} onSelect={p=>{setDestination(p.label);setDestPlace(p)}} error={fieldErrors.destination}/>
      <label className="label">Producto<input className="input normal-case tracking-normal" value={product} onChange={e=>setProduct(e.target.value)} placeholder="Pellet"/>{fieldErrors.product && <p className="mt-1 text-xs font-normal normal-case tracking-normal text-red-300">{fieldErrors.product}</p>}</label>
      <DateTimeField label="Salida" value={departure} onChange={setDeparture} min={minDeparture} error={fieldErrors.departure}/>
      <label className="label">Latitud origen<input className="input normal-case tracking-normal cursor-not-allowed text-slate-400" value={originPlace?originPlace.lat.toFixed(4):''} readOnly placeholder="Se completa al elegir el origen"/></label>
      <label className="label">Longitud origen<input className="input normal-case tracking-normal cursor-not-allowed text-slate-400" value={originPlace?originPlace.lng.toFixed(4):''} readOnly placeholder="Se completa al elegir el origen"/></label>
      <label className="label">Latitud destino<input className="input normal-case tracking-normal cursor-not-allowed text-slate-400" value={destPlace?destPlace.lat.toFixed(4):''} readOnly placeholder="Se completa al elegir el destino"/></label>
      <label className="label">Longitud destino<input className="input normal-case tracking-normal cursor-not-allowed text-slate-400" value={destPlace?destPlace.lng.toFixed(4):''} readOnly placeholder="Se completa al elegir el destino"/></label>
      <label className="label">Radio geocerca (m)<input className="input normal-case tracking-normal" type="number" min={1} step={1} value={radius} onChange={e=>setRadius(e.target.value)} placeholder="1500"/>{fieldErrors.radius && <p className="mt-1 text-xs font-normal normal-case tracking-normal text-red-300">{fieldErrors.radius}</p>}</label>
    </div>
    <div className="mt-4"><WagonAssignment pool={pool} picks={picks} onToggle={toggleWagon} onDevice={setDeviceFor} error={fieldErrors.wagons}/></div>
    {originPlace && destPlace && <div className="mt-4 h-40 overflow-hidden rounded-xl panel p-1"><MapContainer key={`${originPlace.lat},${originPlace.lng}-${destPlace.lat},${destPlace.lng}`} bounds={[[originPlace.lat,originPlace.lng],[destPlace.lat,destPlace.lng]]} boundsOptions={{padding:[24,24]}} scrollWheelZoom={false} dragging={false} zoomControl={false} doubleClickZoom={false} touchZoom={false} className="z-0"><TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><Polyline positions={[[originPlace.lat,originPlace.lng],[destPlace.lat,destPlace.lng]]} pathOptions={{color:'#22d3ee',weight:3,dashArray:'8 8'}}/><CircleMarker center={[originPlace.lat,originPlace.lng]} radius={7} pathOptions={{color:'#38bdf8',fillColor:'#38bdf8',fillOpacity:1}}/><CircleMarker center={[destPlace.lat,destPlace.lng]} radius={7} pathOptions={{color:'#34d399',fillColor:'#34d399',fillOpacity:1}}/></MapContainer></div>}
    {Object.keys(picks).length>0 && <p className="mt-4 text-xs text-slate-400">Vas a crear un viaje con <b className="text-slate-200">{Object.keys(picks).length}</b> {Object.keys(picks).length===1?'vagón':'vagones'}.</p>}
    {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
    <div className="mt-6 flex justify-end gap-3"><button type="button" className="btn-muted" onClick={onClose} disabled={busy}>Cancelar</button><button className="btn-primary" disabled={busy}>{busy?'Creando…':'Crear viaje'}</button></div>
  </form></div>
}
function WagonAssignment({pool,picks,onToggle,onDevice,error}:{pool?:{wagons:{id:number;code:string}[];devices:{id:number;code:string}[]};picks:Record<number,number>;onToggle:(wagonId:number)=>void;onDevice:(wagonId:number,deviceId:number)=>void;error?:string}){
  if(!pool) return <p className="text-xs text-slate-500">Cargando vagones disponibles…</p>
  if(pool.wagons.length===0) return <p className="text-xs text-amber-300">No hay vagones disponibles en este momento.</p>
  const count=Object.keys(picks).length
  return <div>
    <div className="mb-2 flex items-center justify-between"><p className="label">Vagones y dispositivos disponibles</p><span className="text-xs text-slate-400">{count} seleccionado{count===1?'':'s'}</span></div>
    <div className="max-h-56 space-y-1.5 overflow-auto rounded-lg border border-slate-800 p-2">
      {pool.wagons.map(w=>{
        const checked=w.id in picks
        const usedByOthers=new Set(Object.entries(picks).filter(([wid])=>Number(wid)!==w.id).map(([,did])=>did))
        const options=pool.devices.filter(d=>!usedByOthers.has(d.id))
        return <div key={w.id} className="flex items-center gap-2 rounded-lg bg-slate-900/60 px-2.5 py-1.5">
          <input type="checkbox" checked={checked} onChange={()=>onToggle(w.id)} className="h-4 w-4 accent-cyan-400"/>
          <span className="w-20 shrink-0 text-sm font-semibold text-slate-200">{w.code}</span>
          <select disabled={!checked} value={picks[w.id]||''} onChange={e=>onDevice(w.id,Number(e.target.value))} className="input flex-1 py-1.5 text-xs normal-case tracking-normal disabled:opacity-40">
            <option value="" disabled>Selecciona dispositivo</option>
            {options.map(d=><option key={d.id} value={d.id}>{d.code}</option>)}
          </select>
        </div>
      })}
    </div>
    {error && <p className="mt-1 text-xs font-normal normal-case tracking-normal text-red-300">{error}</p>}
  </div>
}
function ControlCenter({user}:{user:User}){
  const {id}=useParams()
  const [data,setData]=useState<any>(),[selected,setSelected]=useState<Wagon|null>(null),[filter,setFilter]=useState('ALL')
  const [busy,setBusy]=useState(false)
  const load=()=>request<any>(`/trips/${id}`).then(setData).catch(()=>{})
  useEffect(()=>{load();const refresh=()=>load();socket.on('telemetry:update',refresh);socket.on('wagon:status',refresh);socket.on('trip:position',refresh);socket.on('trip:status',refresh);return()=>{socket.off('telemetry:update',refresh);socket.off('wagon:status',refresh);socket.off('trip:position',refresh);socket.off('trip:status',refresh)}},[id])
  if(!data)return <div className="h-96 animate-pulse rounded-xl bg-slate-800"/>
  const trip=data.trip as Trip
  const wagons=(data.wagons as Wagon[]).filter(w=>filter==='ALL'||(filter==='OFFLINE'?!w.online:w.status===filter))
  const startTrip=async()=>{setBusy(true);try{await request(`/trips/${id}/start`,{method:'POST'});toast.success('Viaje iniciado.');await load()}catch(e){toast.error((e as Error).message)}finally{setBusy(false)}}
  const resetTrip=async()=>{
    if(!window.confirm('¿Reiniciar la demostración de este viaje? Se restablecerá el progreso, la posición, la batería, los candados/compuertas y se resolverán las alertas activas.')) return
    setBusy(true);try{await request(`/trips/${id}/reset`,{method:'POST'});toast.success('Demostración reiniciada.');await load()}catch(e){toast.error((e as Error).message)}finally{setBusy(false)}
  }
  return <>
    <PageTitle action={user.role!=='VIEWER' && trip.status==='PLANNED'?<button onClick={startTrip} disabled={busy} className="btn-primary"><Play size={14}/>{busy?'Iniciando…':'Iniciar viaje'}</button>:user.role!=='VIEWER' && trip.status==='ARRIVED'?<button onClick={resetTrip} disabled={busy} className="btn-muted"><RotateCcw size={14}/>{busy?'Reiniciando…':'Reiniciar demostración'}</button>:undefined}>
      <p className="label">Control Center · En vivo</p><div className="mt-1 flex flex-wrap items-center gap-3"><h1 className="text-2xl font-bold">{trip.code}</h1><Badge value={trip.status}/></div><p className="mt-1 text-sm text-slate-400">{trip.origin} → {trip.destination} · {trip.product} · {data.wagons.length} vagones</p>
    </PageTitle>
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="Progreso de ruta" value={`${Math.round(trip.progress*100)}%`} icon={<MapPin/>}/><Metric label="Velocidad promedio" value={`${Math.round(data.wagons.reduce((a:number,w:Wagon)=>a+w.speed,0)/data.wagons.length)} km/h`} icon={<Gauge/>}/><Metric label="Geocerca" value={`${trip.geofence_radius.toLocaleString()} m`} icon={<ShieldCheck/>}/><Metric label="Telemetría" value="3 s" icon={<Radio/>}/></div><div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]"><section className="panel h-[530px] p-3"><TripMap trip={trip} wagons={data.wagons}/></section><aside className="panel flex min-h-0 flex-col"><div className="border-b border-slate-800 p-4"><div className="flex items-center justify-between"><h2 className="font-semibold">Vagones ({data.wagons.length})</h2><ListFilter size={17} className="text-slate-500"/></div><div className="mt-3 flex gap-1 overflow-auto">{['ALL','ONLINE','WARNING','CRITICAL','OFFLINE'].map(f=><button onClick={()=>setFilter(f)} key={f} className={`rounded px-2 py-1 text-[10px] font-bold ${filter===f?'bg-cyan-400 text-slate-950':'bg-slate-800 text-slate-400'}`}>{f==='ALL'?'TODOS':label(f)}</button>)}</div></div><div className="max-h-[430px] overflow-auto p-2">{wagons.map(w=><button key={w.id} onClick={()=>setSelected(w)} className="mb-1 flex w-full items-center justify-between rounded-lg p-3 text-left hover:bg-slate-800"><div className="flex items-center gap-3"><span className={`h-2.5 w-2.5 rounded-full ${colors[w.status]}`}/><div><p className="text-sm font-semibold">{w.wagonId}</p><p className="text-xs text-slate-500">{w.deviceId} · {w.battery}%</p></div></div><div className="text-right text-xs"><p className={w.lockStatus==='LOCKED'?'text-slate-300':'text-emerald-400'}>{label(w.lockStatus)}</p><p className="text-slate-500">{w.geofence==='INSIDE_GEOFENCE'?'Zona autorizada':'En ruta'}</p></div></button>)}</div></aside></div><section className="panel mt-5 p-4"><p className="label mb-3">Feed de eventos en tiempo real</p><div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">{data.events.slice(0,8).map((e:any)=><div key={e.id} className="rounded-lg bg-slate-950 p-3"><p className="text-xs text-cyan-400">{formatTime(e.timestamp)}</p><p className="mt-1 text-sm">{e.action.replaceAll('_',' ')}</p><p className="text-xs text-slate-500">{e.reason||e.result}</p></div>)}</div></section>{selected&&<WagonDrawer wagon={selected} trip={trip} user={user} close={()=>setSelected(null)} refresh={load}/>}</>}
function Metric({label,value,icon}:{label:string;value:string;icon:React.ReactNode}){return <div className="panel flex items-center gap-3 p-4"><div className="rounded-lg bg-cyan-400/10 p-2 text-cyan-400">{icon}</div><div><p className="text-sm font-semibold">{value}</p><p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p></div></div>}
function WagonDrawer({wagon,trip,user,close,refresh}:{wagon:Wagon;trip:Trip;user:User;close:()=>void;refresh:()=>void}){const [detail,setDetail]=useState<any>(),[requestToken,setRequestToken]=useState<string>(),[error,setError]=useState(''),[code,setCode]=useState(''),[success,setSuccess]=useState('');useEffect(()=>{request(`/wagons/${wagon.id}`).then(setDetail).catch(()=>{})},[wagon.id]);const ask=async()=>{setError('');try{const d=await request<any>(`/wagons/${wagon.id}/request-unlock`,{method:'POST'});setRequestToken(d.unlockToken)}catch(e){setError((e as Error).message);refresh()}};const confirm=async()=>{try{await request(`/wagons/${wagon.id}/confirm-unlock`,{method:'POST',body:JSON.stringify({unlockToken:requestToken,code})});setSuccess(`${wagon.wagonId} desbloqueado correctamente.`);refresh();setRequestToken(undefined)}catch(e){setError((e as Error).message)}};const isIn=wagon.geofence==='INSIDE_GEOFENCE';return <div className="fixed inset-0 z-30 flex justify-end bg-black/40"><aside className="h-full w-full max-w-md overflow-auto border-l border-slate-700 bg-slate-950 p-5 shadow-2xl"><div className="flex items-start justify-between"><div><p className="label">Detalle de vagón</p><h2 className="text-2xl font-bold">{wagon.wagonId}</h2><p className="text-sm text-slate-400">{wagon.deviceId} · {wagon.tripCode}</p></div><button onClick={close} className="rounded p-1 text-slate-400 hover:bg-slate-800"><X/></button></div><div className="mt-5 grid grid-cols-2 gap-3"><Tile label="Batería" value={`${wagon.battery}%`} warn={wagon.battery<20}/><Tile label="Velocidad" value={`${wagon.speed} km/h`}/><Tile label="Candado" value={label(wagon.lockStatus)}/><Tile label="Compuerta" value={label(wagon.doorStatus)} warn={wagon.doorStatus==='OPEN'}/><Tile label="Estado" value={label(wagon.status)} warn={wagon.status==='CRITICAL'}/><Tile label="Tamper" value={wagon.tamper?'DETECTADO':'NORMAL'} warn={wagon.tamper}/><Tile label="Última comunicación" value={formatTime(wagon.lastSeen)} warn={!wagon.online}/></div><div className="mt-4 h-48 panel p-2"><TripMap trip={trip} wagons={[wagon]} compact/></div>{detail?.telemetry?.length>1 && <div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-lg bg-slate-900 p-3"><p className="label mb-1">Batería (histórico)</p><Sparkline data={[...detail.telemetry].reverse().map((t:any)=>t.battery)} color="#22d3ee"/></div><div className="rounded-lg bg-slate-900 p-3"><p className="label mb-1">Velocidad (histórico)</p><Sparkline data={[...detail.telemetry].reverse().map((t:any)=>t.speed)} color="#34d399"/></div></div>}<div className={`mt-4 rounded-lg border p-4 ${isIn?'border-emerald-500/40 bg-emerald-500/10':'border-amber-500/40 bg-amber-500/10'}`}><div className="flex gap-2"><MapPin className={isIn?'text-emerald-400':'text-amber-400'} size={18}/><div><p className="text-sm font-bold">{isIn?'ZONA AUTORIZADA':'DESBLOQUEO NO DISPONIBLE'}</p><p className="mt-1 text-xs text-slate-400">{isIn?'El vagón se encuentra dentro de la zona autorizada de descarga.':'El vagón no se encuentra dentro de la zona autorizada de descarga.'}</p></div></div></div>{success&&<p className="mt-3 rounded bg-emerald-500/10 p-3 text-sm text-emerald-300">{success}</p>}{error&&<p className="mt-3 rounded bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}{user.role==='VIEWER'?<p className="mt-4 text-sm text-slate-500">Tu rol tiene acceso únicamente de lectura.</p>:!requestToken?<button onClick={ask} disabled={!isIn||wagon.lockStatus!=='LOCKED'} className="btn-primary mt-4 w-full"><Unlock size={17}/>{isIn?'SOLICITAR DESBLOQUEO':'DESBLOQUEO NO DISPONIBLE'}</button>:<div className="mt-4 rounded-xl border border-cyan-500/40 bg-cyan-500/5 p-4"><p className="font-semibold">Solicitud de desbloqueo</p><p className="mt-1 text-xs text-slate-400">Validaciones aprobadas. Introduce el segundo factor de esta demo.</p><label className="label mt-3 block">Código MFA<input value={code} onChange={e=>setCode(e.target.value)} className="input normal-case tracking-[.4em]" placeholder="123456" maxLength={6}/></label><button onClick={confirm} className="btn-primary mt-3 w-full"><ShieldCheck size={16}/>Confirmar autorización</button></div>}<div className="mt-6"><p className="label">Últimos eventos</p>{detail?.events?.slice(0,5).map((e:any)=><div key={e.id} className="mt-2 border-l border-slate-700 pl-3"><p className="text-xs font-semibold">{e.action}</p><p className="text-[11px] text-slate-500">{formatTime(e.timestamp)} · {e.result}</p></div>)}</div></aside></div>}
function Tile({label,value,warn}:{label:string;value:string;warn?:boolean}){return <div className="rounded-lg bg-slate-900 p-3"><p className="label">{label}</p><p className={`mt-1 text-sm font-bold ${warn?'text-amber-300':''}`}>{value}</p></div>}
function Sparkline({data,color}:{data:number[];color:string}){
  if(data.length<2) return <p className="text-xs text-slate-600">Sin datos suficientes.</p>
  const w=240,h=40,max=Math.max(...data),min=Math.min(...data),range=max-min||1
  const points=data.map((v,i)=>`${(i/(data.length-1))*w},${h-((v-min)/range)*h}`).join(' ')
  return <svg viewBox={`0 0 ${w} ${h}`} className="h-10 w-full" preserveAspectRatio="none"><polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"/></svg>
}
function AssetList({devices=false,user}:{devices?:boolean;user:User}){
  const [trips,setTrips]=useState<Trip[]>([])
  const [trip,setTrip]=useState<Trip>(),[wagons,setWagons]=useState<Wagon[]>([]),[loading,setLoading]=useState(true)
  const [search,setSearch]=useState(''),[filter,setFilter]=useState('ALL')
  const [selected,setSelected]=useState<Wagon|null>(null)
  useEffect(()=>{
    const loadTrips=()=>request<Trip[]>('/trips').then(list=>{setTrips(list);setTrip(prev=>prev?(list.find(t=>t.id===prev.id)||prev):(list.find(t=>t.status==='ACTIVE'||t.status==='ARRIVED')||list[0]));setLoading(false)}).catch(()=>setLoading(false))
    loadTrips()
    socket.on('trip:status',loadTrips); socket.on('trip:position',loadTrips)
    return ()=>{socket.off('trip:status',loadTrips);socket.off('trip:position',loadTrips)}
  },[])
  const loadWagons=()=>{if(!trip)return;request<Wagon[]>(`/trips/${trip.id}/wagons`).then(setWagons).catch(()=>{})}
  useEffect(()=>{
    loadWagons()
    socket.on('wagon:status',loadWagons); socket.on('telemetry:update',loadWagons)
    return ()=>{socket.off('wagon:status',loadWagons);socket.off('telemetry:update',loadWagons)}
  },[trip?.id])
  const title=devices?'Dispositivos IoT':'Vagones monitoreados'
  const subtitle=devices?'Estado de conectividad, batería y telemetría de cada dispositivo.':'Inventario operativo de los vagones asignados al viaje seleccionado.'
  if(loading)return <div className="h-96 animate-pulse rounded-xl bg-slate-800"/>
  if(!trip)return <Empty icon={devices?<Cpu/>:<Box/>} text="No hay viajes registrados en el sistema."/>
  const filtered=wagons.filter(w=>(filter==='ALL'||(filter==='OFFLINE'?!w.online:w.status===filter)) && (search.trim()===''||`${w.wagonId} ${w.deviceId}`.toLowerCase().includes(search.trim().toLowerCase())))
  return <>
    <PageTitle action={<NavLink to={`/trips/${trip.id}`} className="btn-muted"><MapIcon size={16}/>Abrir Control Center</NavLink>}><p className="label">Inventario operativo</p><h1 className="mt-1 text-2xl font-bold">{title}</h1><p className="mt-1 text-sm text-slate-400">{subtitle}</p></PageTitle>
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label={devices?'Dispositivos activos':'Vagones activos'} value={String(wagons.length)} icon={devices?<Cpu/>:<Box/>}/><Metric label="En línea" value={String(wagons.filter(w=>w.online).length)} icon={<Wifi/>}/><Metric label="Advertencias" value={String(wagons.filter(w=>w.status==='WARNING').length)} icon={<AlertTriangle/>}/><Metric label="Críticos" value={String(wagons.filter(w=>w.status==='CRITICAL').length)} icon={<ShieldCheck/>}/></div>
    <section className="panel overflow-x-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-4">
        <select value={trip.id} onChange={e=>setTrip(trips.find(t=>t.id===Number(e.target.value)))} className="input w-auto normal-case tracking-normal">{trips.map(t=><option key={t.id} value={t.id}>{t.code} · {t.origin} → {t.destination} ({label(t.status)})</option>)}</select>
        <div className="flex flex-wrap items-center gap-2">
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder={devices?'Buscar dispositivo…':'Buscar vagón…'} className="input w-44 normal-case tracking-normal"/>
          <div className="flex flex-wrap gap-1">{['ALL','ONLINE','WARNING','CRITICAL','OFFLINE'].map(f=><button onClick={()=>setFilter(f)} key={f} className={`rounded px-2 py-1 text-[10px] font-bold ${filter===f?'bg-cyan-400 text-slate-950':'bg-slate-800 text-slate-400'}`}>{f==='ALL'?'TODOS':label(f)}</button>)}</div>
        </div>
      </div>
      {filtered.length===0?<div className="p-8"><Empty icon={devices?<Cpu/>:<Box/>} text="Ningún resultado coincide con la búsqueda o el filtro."/></div>:
      <table className="w-full text-left text-sm"><thead className="border-b border-slate-800 bg-slate-900 text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="p-4">{devices?'Dispositivo':'Vagón'}</th><th className="p-4">{devices?'Vagón asignado':'Dispositivo IoT'}</th><th className="p-4">Estado</th><th className="p-4">Batería</th><th className="p-4">Seguridad</th><th className="p-4">Ubicación</th><th className="p-4">Última comunicación</th></tr></thead><tbody>{filtered.map(w=><tr key={w.id} onClick={()=>setSelected(w)} className="cursor-pointer border-b border-slate-800/70 transition hover:bg-slate-900/70"><td className="p-4 font-semibold text-cyan-300">{devices?w.deviceId:w.wagonId}</td><td className="p-4 text-slate-300">{devices?w.wagonId:w.deviceId}</td><td className="p-4"><Badge value={w.status}/></td><td className="p-4"><span className={w.battery<20?'font-bold text-amber-300':''}>{w.battery}%</span></td><td className="p-4 text-xs"><span className={w.tamper||w.doorStatus==='OPEN'?'text-red-300':'text-emerald-300'}>{w.tamper?'MANIPULACIÓN':`${label(w.lockStatus)} · ${label(w.doorStatus)}`}</span></td><td className="p-4"><span className={`text-xs ${w.geofence==='INSIDE_GEOFENCE'?'text-emerald-300':'text-slate-400'}`}>{w.geofence==='INSIDE_GEOFENCE'?'Zona autorizada':'En ruta'}</span></td><td className="p-4 text-xs text-slate-400">{formatTime(w.lastSeen)}</td></tr>)}</tbody></table>}
    </section>
    {selected&&<WagonDrawer wagon={selected} trip={trip} user={user} close={()=>setSelected(null)} refresh={loadWagons}/>}
  </>
}
function Wagons({user}:{user:User}){return <AssetList user={user}/>}
function Devices({user}:{user:User}){return <AssetList devices user={user}/>}
function Empty({icon,text}:{icon:React.ReactNode;text:string}){return <div className="panel grid min-h-[300px] place-items-center p-8 text-center"><div><div className="mx-auto mb-3 w-fit text-slate-600">{icon}</div><p className="text-slate-400">{text}</p></div></div>}
function Alerts({user}:{user:User}){const [alerts,setAlerts]=useState<any[]>([]);const [pending,setPending]=useState<Set<number>>(new Set());const load=()=>request<any[]>('/alerts').then(setAlerts).catch(()=>{});useEffect(()=>{load();socket.on('alert:new',load);socket.on('alert:update',load);return()=>{socket.off('alert:new',load);socket.off('alert:update',load)}},[]);const act=async(id:number,path:string,successMsg:string)=>{if(pending.has(id))return;setPending(p=>new Set(p).add(id));try{await request(`/alerts/${id}/${path}`,{method:'POST'});toast.success(successMsg);await load()}catch(e){toast.error((e as Error).message)}finally{setPending(p=>{const n=new Set(p);n.delete(id);return n})}};const ack=(id:number)=>act(id,'acknowledge','Alerta reconocida.');const archive=(id:number)=>act(id,'archive','Alerta archivada.');const visible=alerts.filter(a=>a.status!=='ARCHIVED');return <><PageTitle><p className="label">Seguridad</p><h1 className="mt-1 text-2xl font-bold">Alertas operativas</h1><p className="mt-1 text-sm text-slate-400">Eventos generados automáticamente por los dispositivos simulados.</p></PageTitle><div className="space-y-3">{visible.length===0?<Empty icon={<ShieldCheck/>} text="No existen alertas registradas."/>:visible.map(a=><article key={a.id} className={`panel flex flex-wrap items-center gap-4 border-l-4 p-4 ${a.severity==='CRITICAL'?'border-l-red-500':a.severity==='WARNING'?'border-l-amber-400':'border-l-cyan-400'}`}><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><Badge value={a.severity}/><Badge value={a.status}/><span className="text-xs text-slate-500">{formatTime(a.created_at)}</span></div><h2 className="mt-2 font-semibold">{label(a.type)}</h2><p className="text-sm text-slate-400">{a.description}</p><p className="mt-1 text-xs text-slate-500">{a.trip_code||'—'} · {a.wagon_code||'Sistema'} · {a.device_code||'—'}</p></div>{a.status==='ACTIVE'&&user.role!=='VIEWER'&&<button onClick={()=>ack(a.id)} disabled={pending.has(a.id)} className="btn-muted">{pending.has(a.id)?'Reconociendo…':'Reconocer'}</button>}{(a.status==='ACKNOWLEDGED'||a.status==='RESOLVED')&&user.role!=='VIEWER'&&<button onClick={()=>archive(a.id)} disabled={pending.has(a.id)} className="btn-muted">{pending.has(a.id)?'Archivando…':'Archivar'}</button>}</article>)}</div></>}
function Audit(){const [items,setItems]=useState<any[]>([]);const load=()=>request<any[]>('/audit').then(setItems).catch(()=>{});useEffect(()=>{load();socket.on('audit:new',load);return()=>{socket.off('audit:new',load)}},[]);return <><PageTitle><p className="label">Trazabilidad operativa</p><h1 className="mt-1 text-2xl font-bold">Bitácora de seguridad</h1><p className="mt-1 text-sm text-slate-400">Historial de acciones, decisiones y eventos del sistema.</p></PageTitle><section className="panel overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-slate-800 bg-slate-900 text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="p-4">Hora</th><th className="p-4">Acción</th><th className="p-4">Usuario</th><th className="p-4">Contexto</th><th className="p-4">Resultado</th><th className="p-4">Motivo</th></tr></thead><tbody>{items.map(e=><tr key={e.id} className="border-b border-slate-800/70"><td className="p-4 text-slate-400">{formatTime(e.timestamp)}</td><td className="p-4 font-semibold text-cyan-300">{e.action}</td><td className="p-4">{e.user_name||'Sistema'}</td><td className="p-4 text-slate-400">{e.trip_code||'—'} {e.wagon_code&&`· ${e.wagon_code}`}</td><td className="p-4"><Badge value={e.result}/></td><td className="max-w-xs p-4 text-xs text-slate-400">{e.reason||'—'}</td></tr>)}</tbody></table></section></>}
function Simulator({user}:{user:User}){const [trips,setTrips]=useState<Trip[]>([]),[trip,setTrip]=useState<Trip>(),[wagons,setWagons]=useState<Wagon[]>([]),[wagon,setWagon]=useState<string>('');useEffect(()=>{request<Trip[]>('/trips').then(x=>{setTrips(x);const first=x.find(t=>t.status==='ACTIVE'||t.status==='ARRIVED')||x[0];setTrip(first)}).catch(()=>{})},[]);useEffect(()=>{if(!trip)return;request<Wagon[]>(`/trips/${trip.id}/wagons`).then(x=>{setWagons(x);setWagon(String(x[0]?.id||''))}).catch(()=>{})},[trip?.id]);const fire=async(event:string)=>{if(!trip||!wagon)return;try{await request('/simulator/event',{method:'POST',body:JSON.stringify({tripId:trip.id,wagonId:Number(wagon),event})});toast.success(`Evento ${event.replaceAll('_',' ')} aplicado correctamente.`);if(event==='MOVE_DESTINATION') setTrip({...trip,status:'ARRIVED',progress:.995});await request<Wagon[]>(`/trips/${trip.id}/wagons`).then(setWagons).catch(()=>{})}catch(e){toast.error((e as Error).message)}};if(user.role==='VIEWER')return <Empty icon={<SlidersHorizontal/>} text="El simulador requiere permisos de operador."/>;const events=[['LOW_BATTERY','SIMULAR BATERÍA BAJA','warning'],['OFFLINE','SIMULAR PÉRDIDA DE CONEXIÓN','critical'],['TAMPER','SIMULAR MANIPULACIÓN','critical'],['OPEN_DOOR','SIMULAR APERTURA NO AUTORIZADA','critical'],['OFF_ROUTE','SACAR VAGÓN DE RUTA','warning'],['RESTORE','RESTAURAR VAGÓN','normal']];return <><PageTitle><p className="label">Herramientas de demostración</p><h1 className="mt-1 text-2xl font-bold">Simulador IoT</h1><p className="mt-1 text-sm text-slate-400">Inyecta eventos controlados para probar el monitoreo y las alertas.</p></PageTitle><div className="grid gap-5 lg:grid-cols-[.9fr_1.1fr]"><section className="panel-pad"><label className="label">Viaje<select className="input normal-case tracking-normal" value={trip?.id||''} onChange={e=>setTrip(trips.find(t=>t.id===Number(e.target.value)))}>{trips.map(t=><option key={t.id} value={t.id}>{t.code} · {t.origin} → {t.destination}</option>)}</select></label><label className="label mt-4 block">Vagón<select className="input normal-case tracking-normal" value={wagon} onChange={e=>setWagon(e.target.value)}>{wagons.map(w=><option key={w.id} value={w.id}>{w.wagonId} · {w.deviceId}</option>)}</select></label>{trip&&<div className="mt-5 h-64"><TripMap trip={trip} wagons={wagons} compact/></div>}<button onClick={()=>fire('MOVE_DESTINATION')} className="btn-primary mt-5 w-full"><MapPin size={16}/>MOVER TREN AL DESTINO</button></section><section className="grid gap-3 sm:grid-cols-2">{events.map(([event,evLabel,tone])=><button key={event} onClick={()=>fire(event)} className={`panel min-h-28 p-5 text-left transition hover:border-cyan-500 ${tone==='critical'?'hover:bg-red-500/5':tone==='warning'?'hover:bg-amber-500/5':'hover:bg-emerald-500/5'}`}><div className="mb-3 flex items-center justify-between"><Activity className={tone==='critical'?'text-red-400':tone==='warning'?'text-amber-400':'text-emerald-400'}/><Play size={15} className="text-slate-500"/></div><p className="text-sm font-bold">{evLabel}</p></button>)}</section></div></>}
function UsersPage(){const users=[['Ana Morales','admin@railguard.demo','ADMIN','Todos los permisos'],['Luis Ortega','operator@railguard.demo','OPERATOR','Operación, alertas y desbloqueo'],['Sofía Reyes','viewer@railguard.demo','VIEWER','Solo lectura']];return <><PageTitle><p className="label">Control de acceso</p><h1 className="mt-1 text-2xl font-bold">Usuarios demo</h1><p className="mt-1 text-sm text-slate-400">RBAC aplicado por el backend en cada acción sensible.</p></PageTitle><div className="grid gap-4 lg:grid-cols-3">{users.map(([name,email,role,desc])=><article className="panel-pad" key={email}><div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-cyan-400/10 font-bold text-cyan-300">{name[0]}</div><h2 className="font-bold">{name}</h2><p className="mt-1 text-sm text-slate-400">{email}</p><div className="mt-4"><Badge value={role==='ADMIN'?'CRITICAL':role==='OPERATOR'?'ACTIVE':'WARNING'}/></div><p className="mt-4 text-sm text-slate-400">{desc}</p></article>)}</div></>}
function SecureLogin({onLogin}:{onLogin:(user:User)=>void}) {
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [slow,setSlow]=useState(false)
  const [serverState,setServerState]=useState<'checking'|'ready'|'delayed'>('checking')
  useEffect(()=>{let active=true;request('/health').then(()=>{if(active)setServerState('ready')}).catch(()=>{if(active)setServerState('delayed')});return()=>{active=false}},[])
  const submit=async(event:FormEvent)=>{
    event.preventDefault();setBusy(true);setSlow(false);setError('')
    const slowTimer=window.setTimeout(()=>setSlow(true),6000)
    try{const data=await request<{token:string;user:User}>('/auth/login',{method:'POST',body:JSON.stringify({email,password})});auth.set(data.token);onLogin(data.user)}
    catch(reason){setError((reason as Error).message)}
    finally{window.clearTimeout(slowTimer);setBusy(false);setSlow(false)}
  }
  return <main className="grid min-h-screen place-items-center bg-[radial-gradient(ellipse_at_top,#12304a,#020617_55%)] p-5"><form onSubmit={submit} className="panel w-full max-w-md p-8"><div className="mb-8 flex items-center gap-3"><div className="rounded-xl bg-cyan-400 p-3 text-slate-950"><Train/></div><div><h1 className="text-2xl font-bold">RailGuard</h1><p className="text-sm text-slate-400">Railway Telemetry & Security Platform</p></div></div><h2 className="mb-1 text-lg font-semibold">Acceso al centro de control</h2><p className="mb-4 text-sm text-slate-400">Usa una cuenta demo para iniciar sesión.</p><div className={`mb-5 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${serverState==='ready'?'bg-emerald-500/10 text-emerald-300':serverState==='delayed'?'bg-amber-500/10 text-amber-300':'bg-cyan-500/10 text-cyan-300'}`}><span className={`h-2 w-2 rounded-full ${serverState==='ready'?'bg-emerald-400':serverState==='delayed'?'bg-amber-400':'animate-pulse bg-cyan-400'}`}/>{serverState==='ready'?'Servidor conectado':serverState==='delayed'?'El servidor gratuito está tardando; puedes reintentar':'Preparando servidor gratuito…'}</div><label className="label">Correo<input className="input normal-case tracking-normal" value={email} onChange={e=>setEmail(e.target.value)} type="email" autoComplete="username" placeholder="operator@railguard.demo"/></label><label className="label mt-4 block">Contraseña<input className="input normal-case tracking-normal" value={password} onChange={e=>setPassword(e.target.value)} type="password" autoComplete="current-password" placeholder="••••••••"/></label>{slow&&<p className="mt-4 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">Render está despertando. En el plan gratuito puede tardar cerca de un minuto.</p>}{error&&<p className="mt-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}<button disabled={busy||!email||!password} className="btn-primary mt-6 w-full">{busy?(slow?'Despertando servidor…':'Verificando…'):'Ingresar al sistema'}<ChevronRight size={16}/></button><p className="mt-5 text-xs leading-5 text-slate-500">Operador: operator@railguard.demo · Operator123!</p></form></main>
}
function App(){const [user,setUser]=useState<User|null>(null);useEffect(()=>{const resetSession=()=>setUser(null);window.addEventListener('railguard:unauthorized',resetSession);return()=>window.removeEventListener('railguard:unauthorized',resetSession)},[]);useEffect(()=>{if(user)socket.connect();else socket.disconnect();return()=>{socket.disconnect()}},[user]);return <>{!user?<SecureLogin onLogin={setUser}/>:<Shell user={user} onLogout={()=>{auth.clear();setUser(null)}}/>}<Toaster/></>}
export default App
