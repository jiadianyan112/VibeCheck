import { domainToASCII } from 'node:url'

import { identityError } from './errors.js'

const allowedFrontstageRoots = new Set([
  '/projects',
  '/categories',
  '/activity',
  '/search',
  '/discover',
  '/project',
  '/compare',
  '/submit',
  '/creator',
  '/me',
  '/notifications',
  '/auth',
  '/about',
])

export function normalizeEmail(value: string): string {
  const input = value.trim().normalize('NFKC')
  const containsControlOrWhitespace = Array.from(input).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || codePoint === 0x7f || /\s/u.test(character)
  })
  if (input.length < 3 || input.length > 254 || containsControlOrWhitespace) {
    throw identityError('EMAIL_INVALID', 422)
  }
  const at = input.lastIndexOf('@')
  if (at < 1 || at === input.length - 1) throw identityError('EMAIL_INVALID', 422)
  const local = input.slice(0, at).toLowerCase()
  const domain = domainToASCII(input.slice(at + 1).toLowerCase())
  if (
    local.length > 64 ||
    !domain ||
    domain.length > 253 ||
    !domain.includes('.') ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..') ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local) ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(domain) ||
    domain.includes('..')
  ) {
    throw identityError('EMAIL_INVALID', 422)
  }
  return `${local}@${domain}`
}

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@')
  const visible = local.slice(0, Math.min(2, local.length))
  return `${visible}${'*'.repeat(Math.max(3, Math.min(8, local.length - visible.length)))}@${domain}`
}

export function normalizeReturnTo(value: string): string {
  if (!value || value.length > 2_048 || !value.startsWith('/') || value.startsWith('//')) {
    return '/me'
  }
  let parsed: URL
  try {
    parsed = new URL(value, 'https://vibecheck.invalid')
  } catch {
    return '/me'
  }
  if (parsed.origin !== 'https://vibecheck.invalid') return '/me'
  const firstSegment = `/${parsed.pathname.split('/').filter(Boolean)[0] ?? ''}`
  if (firstSegment === '/admin') return value
  if (!allowedFrontstageRoots.has(firstSegment)) return '/me'
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

export function canUseReturnTo(value: string, roles: readonly string[]): boolean {
  if (!value.startsWith('/admin')) return true
  return roles.includes('editor') || roles.includes('admin')
}
