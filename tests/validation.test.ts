import { describe, expect, it } from 'vitest'
import { validateFile } from '../src/lib/validation'

function fakeFile(name: string, size = 128): File {
  return { name, size, type: 'text/plain' } as File
}

describe('document validation', () => {
  it('accepts supported document extensions', () => {
    for (const name of ['facts.pdf', 'facts.docx', 'facts.txt', 'facts.md', 'facts.markdown']) {
      expect(() => validateFile(fakeFile(name))).not.toThrow()
    }
  })

  it('rejects unsupported and oversized inputs', () => {
    expect(() => validateFile(fakeFile('facts.rtf'))).toThrow(/Unsupported/)
    expect(() => validateFile(fakeFile('facts.txt', 26 * 1024 * 1024))).toThrow(/25 MB/)
  })
})
