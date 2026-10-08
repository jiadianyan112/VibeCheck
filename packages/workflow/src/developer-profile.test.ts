import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseDeveloperProfile } from './developer-profile.js'

describe('developer verification profile', () => {
  it('preserves reviewed team profile fields and permits legacy frozen profiles', () => {
    const profile = { display_name: '微光', bio: '小团队', kind: 'team', avatar_url: 'https://example.com/logo.png', website_url: 'https://example.com' }
    assert.deepEqual(parseDeveloperProfile(profile), profile)
    assert.deepEqual(parseDeveloperProfile({ display_name: 'Legacy' }), { display_name: 'Legacy' })
  })
  it('rejects forged verification claims, invalid kinds and unsafe public profile URLs', () => {
    for (const change of [{ verified: true }, { kind: 'company' }, { avatar_url: 'data:image/png;base64,abc' }, { website_url: 'https://a:b@example.com' }]) assert.throws(() => parseDeveloperProfile({ display_name: 'Dev', ...change }))
  })
})
