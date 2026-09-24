import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadChunk } from './lazyChunk'

describe('loadChunk', () => {
  const reload = vi.fn()

  beforeEach(() => {
    sessionStorage.clear()
    reload.mockReset()
    vi.stubGlobal('location', { ...window.location, reload })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('passes the module through when it loads', async () => {
    await expect(loadChunk(() => Promise.resolve({ x: 1 }))).resolves.toEqual({ x: 1 })
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads once when the file is gone after an update', async () => {
    void loadChunk(() => Promise.reject(new Error('Failed to fetch dynamically imported module')))
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
  })

  it('does not reload again if it already tried — the error surfaces instead', async () => {
    sessionStorage.setItem('chunk-reloaded', '1')
    await expect(loadChunk(() => Promise.reject(new Error('still gone')))).rejects.toThrow('still gone')
    expect(reload).not.toHaveBeenCalled()
  })

  it('a successful load clears the mark so a later update can reload again', async () => {
    sessionStorage.setItem('chunk-reloaded', '1')
    await loadChunk(() => Promise.resolve({}))
    void loadChunk(() => Promise.reject(new Error('gone')))
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
  })
})
