const API = import.meta.env.VITE_API_URL || '/api'
export type User = { id:number; name:string; email:string; role:'ADMIN'|'OPERATOR'|'VIEWER' }
export const auth = { get: () => localStorage.getItem('railguard_token'), set: (t:string) => localStorage.setItem('railguard_token',t), clear: () => localStorage.removeItem('railguard_token') }
export async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string,string> = { 'Content-Type':'application/json', ...(options.headers as Record<string,string> || {}) }
  if(auth.get()) headers.Authorization=`Bearer ${auth.get()}`
  const response=await fetch(`${API}${url}`,{...options,headers})
  const data=await response.json().catch(()=>({}))
  if(!response.ok) throw new Error(data.message || data.errors?.join(' ') || 'Error de comunicación')
  return data
}
