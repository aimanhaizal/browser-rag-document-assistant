import { CHUNK_OVERLAP_WORDS, CHUNK_WORDS } from './constants'
import type { ExtractionPage } from '../types'

export interface TextChunk {
  index: number
  page?: number
  text: string
}

export function chunkPages(
  pages: ExtractionPage[],
  size = CHUNK_WORDS,
  overlap = CHUNK_OVERLAP_WORDS,
): TextChunk[] {
  if (size <= 0 || overlap < 0 || overlap >= size) {
    throw new Error('Chunk size must be positive and overlap must be smaller than the chunk size.')
  }

  const chunks: TextChunk[] = []
  const stride = size - overlap
  for (const page of pages) {
    const words = page.text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
    for (let start = 0; start < words.length; start += stride) {
      const text = words.slice(start, start + size).join(' ').trim()
      if (text) chunks.push({ index: chunks.length, page: page.page, text })
      if (start + size >= words.length) break
    }
  }
  return chunks
}
