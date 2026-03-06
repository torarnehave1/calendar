export type AuthUser = {
  userId: string
  email: string
  role?: string | null
}

const AUTH_SESSION_URL = '/auth/openauth/session'
const MAGIC_BASE = 'https://cookie.vegvisr.org'
const DASHBOARD_BASE = 'https://dashboard.vegvisr.org'

export const readStoredUser = (): AuthUser | null => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem('user')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const userId = parsed.user_id || parsed.oauth_id
    const email = parsed.email
    if (!userId || !email) return null
    return { userId, email, role: parsed.role || null }
  } catch {
    return null
  }
}

export const fetchAuthSession = async (): Promise<AuthUser | null> => {
  try {
    const res = await fetch(AUTH_SESSION_URL, { credentials: 'include' })
    if (!res.ok) return null
    const data = await res.json()
    if (!data?.success || !data?.subject) return null
    return {
      userId: data.subject.id,
      email: data.subject.email,
      role: data.subject.role || null,
    }
  } catch {
    return null
  }
}

export const loginUrl = (redirectTo: string) => {
  const target = encodeURIComponent(redirectTo)
  return `https://login.vegvisr.org?redirect=${target}`
}

export const sendMagicLink = async (email: string, redirectUrl: string) => {
  const res = await fetch(`${MAGIC_BASE}/login/magic/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, redirectUrl }),
  })
  const data = await res.json()
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Failed to send magic link.')
  }
  return data
}

export const verifyMagicToken = async (token: string) => {
  const res = await fetch(
    `${MAGIC_BASE}/login/magic/verify?token=${encodeURIComponent(token)}`,
    { method: 'GET', headers: { 'Content-Type': 'application/json' } }
  )
  const data = await res.json()
  if (!res.ok || !data.success || !data.email) {
    throw new Error(data.error || 'Invalid or expired magic link.')
  }
  return data.email as string
}

export const fetchUserContext = async (email: string) => {
  // Get role
  const roleRes = await fetch(`${DASHBOARD_BASE}/get-role?email=${encodeURIComponent(email)}`)
  const roleData = roleRes.ok ? await roleRes.json() : {}

  // Get user data
  const userRes = await fetch(`${DASHBOARD_BASE}/userdata?email=${encodeURIComponent(email)}`)
  const userData = userRes.ok ? await userRes.json() : {}

  return {
    email,
    role: roleData.role || userData.Role || 'user',
    user_id: userData.user_id || null,
    emailVerificationToken: userData.emailVerificationToken || null,
    oauth_id: userData.oauth_id || userData.user_id || null,
    phone: userData.phone || null,
    phoneVerifiedAt: userData.phone_verified_at || null,
    profileimage: userData.profileimage || null,
  }
}

export const setAuthCookie = (token: string) => {
  if (!token) return
  const isVegvisr = window.location.hostname.endsWith('vegvisr.org')
  const domain = isVegvisr ? '; Domain=.vegvisr.org' : ''
  const maxAge = 60 * 60 * 24 * 30
  document.cookie = `vegvisr_token=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure${domain}`
}

export const clearAuthCookie = () => {
  const isVegvisr = window.location.hostname.endsWith('vegvisr.org')
  const domain = isVegvisr ? '; Domain=.vegvisr.org' : ''
  document.cookie = `vegvisr_token=; Path=/; Max-Age=0${domain}`
}
