import { describe, expect, it } from 'vitest'
import { chunkPages } from '../src/lib/chunking'
import { cosineSimilarity, keepValidCitations, retrieveChunks } from '../src/lib/retrieval'
import type { SourceChunk } from '../src/types'

function chunk(id: string, text: string, embedding: number[]): SourceChunk {
  return {
    id, documentId: 'synthetic', documentName: 'synthetic-project.txt',
    index: Number(id), text, embedding: new Float32Array(embedding),
  }
}

describe('RAG chunking and retrieval', () => {
  it('creates overlapping, page-aware chunks', () => {
    const chunks = chunkPages([{ page: 3, text: 'alpha beta gamma delta epsilon zeta eta theta' }], 5, 2)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toMatchObject({ page: 3, text: 'alpha beta gamma delta epsilon' })
    expect(chunks[1].text).toBe('delta epsilon zeta eta theta')
  })

  it('retrieves the synthetic fact passage first', () => {
    const chunks = [
      chunk('0', 'The launch code name is Juniper Lantern.', [1, 0, 0]),
      chunk('1', 'The cafeteria closes at five.', [0, 1, 0]),
      chunk('2', 'The project color is cobalt.', [0, 0, 1]),
    ]
    const results = retrieveChunks(chunks, new Float32Array([0.98, 0.02, 0]), 2)
    expect(results[0].text).toContain('Juniper Lantern')
    expect(results[0].citationId).toBe('SRC-1')
    expect(cosineSimilarity(results[0].embedding, [1, 0, 0])).toBeCloseTo(1)
  })

  it('removes citation identifiers that are not linked to retrieved chunks', () => {
    const sources = retrieveChunks([chunk('0', 'Supported source.', [1, 0])], [1, 0], 1)
    expect(keepValidCitations('Supported [SRC-1], invented [SRC-99].', sources))
      .toBe('Supported [SRC-1], invented .')
  })
})
