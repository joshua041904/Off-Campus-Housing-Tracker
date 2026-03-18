import { describe, it, expect } from 'vitest'
import { buildObjectKey, validateFileType, validateFileSize } from '../src/storage/objectKey.js'

describe('objectKey', () => {
  it('buildObjectKey format is user_id/YYYY/MM/uuid', () => {
    const key = buildObjectKey('user-123')
    const parts = key.split('/')
    expect(parts.length).toBe(4)
    expect(parts[0]).toBe('user-123')
    expect(parts[1]).toMatch(/^\d{4}$/)
    expect(parts[2]).toMatch(/^\d{2}$/)
    expect(parts[3]).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('rejects invalid file types', () => {
    expect(validateFileType('image/jpeg')).toBe(true)
    expect(validateFileType('image/png')).toBe(true)
    expect(validateFileType('application/pdf')).toBe(true)
    expect(validateFileType('application/x-executable')).toBe(false)
    expect(validateFileType('text/plain')).toBe(false)
  })

  it('rejects invalid file size', () => {
    expect(validateFileSize(0)).toBe(false)
    expect(validateFileSize(-1)).toBe(false)
    expect(validateFileSize(1024)).toBe(true)
    expect(validateFileSize(50 * 1024 * 1024)).toBe(true)
    expect(validateFileSize(50 * 1024 * 1024 + 1)).toBe(false)
  })
})
