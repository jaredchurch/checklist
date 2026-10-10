import { describe, it, expect } from 'vitest'
import {
  environmentForHost,
  selectBuiltInKey,
  readAppKey,
  BUILT_IN_KEYS,
  PRODUCTION_HOSTS
} from '../sync/appKey.js'

/**
 * The client id is compiled in and selected by hostname. Getting the selection
 * wrong means a stray local run publishes over the deployed site's checklists,
 * and there is nothing afterwards to say which copy was which — so these are
 * worth pinning down rather than leaving to inspection.
 */
describe('environment selection', () => {
  it('uses the production app on the deployed host', () => {
    expect(environmentForHost(PRODUCTION_HOSTS[0])).toBe('production')
  })

  it('uses the testing app everywhere else, including localhost', () => {
    // The important one: `npm run build` served by `vite preview` is a
    // production *build* on a non-production *host*.
    expect(environmentForHost('localhost')).toBe('development')
    expect(environmentForHost('127.0.0.1')).toBe('development')
    expect(environmentForHost('')).toBe('development')
  })

  it('does not match a lookalike host by suffix', () => {
    // `includes` on a hostname list would let a lookalike reach production.
    expect(environmentForHost('evil-jaredchurch.github.io')).toBe('development')
    expect(environmentForHost('jaredchurch.github.io.evil.test')).toBe('development')
  })
})

describe('the built-in keys', () => {
  it('are the registered values', () => {
    expect(BUILT_IN_KEYS.production).toBe('l131kro8izrkyfq')
    expect(BUILT_IN_KEYS.development).toBe('4ivz46qn0205dpp')
  })

  it('are distinct, so the two Dropbox apps really are two app folders', () => {
    // Sharing one key would mean local and production write the same
    // `checklist.json`, which defeats the entire point of having two.
    expect(BUILT_IN_KEYS.production).not.toBe(BUILT_IN_KEYS.development)
  })

  it('have the shape of a Dropbox client id', () => {
    // A typo here surfaces only as an opaque `invalid_client_id` from Dropbox
    // at the moment somebody tries to connect.
    for (const key of Object.values(BUILT_IN_KEYS)) {
      expect(key).toMatch(/^[a-z0-9]{8,64}$/i)
    }
  })

  it('are readable from a bare hostname with no build configuration', () => {
    expect(selectBuiltInKey('jaredchurch.github.io')).toBe(BUILT_IN_KEYS.production)
    expect(selectBuiltInKey('localhost')).toBe(BUILT_IN_KEYS.development)
  })
})

describe('runtime resolution', () => {
  it('returns a key rather than undefined', () => {
    expect(typeof readAppKey()).toBe('string')
    expect(readAppKey().length).toBeGreaterThan(0)
  })
})
