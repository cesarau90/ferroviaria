const API = import.meta.env.VITE_API_URL || '/api'
export type User = { id:number; name:string; email:string; role:'ADMIN'|'OPERATOR'|'VIEWER' }
let activeToken: string | null = null
export const auth = { get: () => activeToken, set: (token:string) => { activeToken=token }, clear: () => { activeToken=null } }
export async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string,string> = { 'Content-Type':'application/json', ...(options.headers as Record<string,string> || {}) }
  if(auth.get()) headers.Authorization=`Bearer ${auth.get()}`
  const response=await fetch(`${API}${url}`,{...options,headers})
  const data=await response.json().catch(()=>({}))
  if(response.status===401 && auth.get()) { auth.clear(); window.dispatchEvent(new Event('railguard:unauthorized')) }
  if(!response.ok) throw new Error(data.message || data.errors?.join(' ') || 'Error de comunicación')
  return data
}
