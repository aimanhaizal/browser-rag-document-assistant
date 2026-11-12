export type DocumentStatus = 'processing' | 'ready' | 'error'

export interface StoredDocument {
  id: string
  hash: string
  name: string
  size: number
  mimeType: string
  status: DocumentStatus
  createdAt: number
  updatedAt: number
  charCount: number
  chunkCount: number
  error?: string
}

export interface SourceChunk {
  id: string
  documentId: string
  documentName: string
  index: number
  page?: number
  text: string
  embedding: Float32Array
}

export interface RetrievedChunk extends SourceChunk {
  score: number
  citationId: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: number
  sources?: RetrievedChunk[]
}

export interface ExtractionPage {
  page?: number
  text: string
}

export interface ProgressState {
  label: string
  value: number
}
