const API = import.meta.env.VITE_API_URL || '/api'
export type User = { id:number; name:string; email:string; role:'ADMIN'|'OPERATOR'|'VIEWER' }
let activeToken: string | null = null
export const auth = { get: () => activeToken, set: (token:string) => { activeToken=token }, clear: () => { activeToken=null } }
export async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string,string> = { ...(options.headers as Record<string,string> || {}) }
  if(options.body && !headers['Content-Type']) headers['Content-Type']='application/json'
  if(auth.get()) headers.Authorization=`Bearer ${auth.get()}`
  const controller=options.signal ? undefined : new AbortController()
  const timeoutId=controller ? window.setTimeout(()=>controller.abort(),75000) : undefined
  const signal=options.signal ?? controller?.signal
  try {
    const response=await fetch(`${API}${url}`,{...options,headers,signal})
    const body=await response.text()
    let data: any={}
    if(body) { try { data=JSON.parse(body) } catch { throw new Error('El servidor devolvió una respuesta inválida.') } }
    if(response.status===401 && auth.get()) { auth.clear(); window.dispatchEvent(new Event('railguard:unauthorized')) }
    if(!response.ok) throw new Error(data.message || data.errors?.join(' ') || 'Error de comunicación')
    return data as T
  }
  catch(error) {
    if(signal?.aborted || (error instanceof DOMException && error.name==='AbortError')) throw new Error('El servidor tardó demasiado en responder. Intenta nuevamente en unos segundos.')
    if(error instanceof TypeError) throw new Error('No fue posible conectar con el servidor. Revisa tu conexión e intenta nuevamente.')
    throw error
  } finally { if(timeoutId!==undefined) window.clearTimeout(timeoutId) }
}
