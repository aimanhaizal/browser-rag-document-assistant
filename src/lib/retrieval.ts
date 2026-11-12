import { DEFAULT_TOP_K } from './constants'
import type { RetrievedChunk, SourceChunk } from '../types'

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return -1
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return -1
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export function retrieveChunks(
  chunks: SourceChunk[],
  queryEmbedding: ArrayLike<number>,
  topK = DEFAULT_TOP_K,
): RetrievedChunk[] {
  return chunks
    .map((chunk) => ({ ...chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
    .filter((chunk) => Number.isFinite(chunk.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((chunk, index) => ({ ...chunk, citationId: `SRC-${index + 1}` }))
}

export function keepValidCitations(answer: string, sources: RetrievedChunk[]): string {
  const valid = new Set(sources.map((source) => source.citationId))
  return answer.replace(/\[SRC-\d+\]/g, (citation) =>
    valid.has(citation.slice(1, -1)) ? citation : '',
  )
}
