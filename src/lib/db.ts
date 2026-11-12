import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { APP_DB_NAME, APP_DB_VERSION } from './constants'
import type { SourceChunk, StoredDocument } from '../types'

interface LocalDocSchema extends DBSchema {
  documents: {
    key: string
    value: StoredDocument
    indexes: { 'by-hash': string }
  }
  chunks: {
    key: string
    value: SourceChunk
    indexes: { 'by-document': string }
  }
}

let dbPromise: Promise<IDBPDatabase<LocalDocSchema>> | undefined

function database() {
  if (!dbPromise) {
    dbPromise = openDB<LocalDocSchema>(APP_DB_NAME, APP_DB_VERSION, {
      upgrade(db) {
        const documents = db.createObjectStore('documents', { keyPath: 'id' })
        documents.createIndex('by-hash', 'hash', { unique: true })
        const chunks = db.createObjectStore('chunks', { keyPath: 'id' })
        chunks.createIndex('by-document', 'documentId')
      },
    })
  }
  return dbPromise
}

export async function listDocuments(): Promise<StoredDocument[]> {
  return (await (await database()).getAll('documents')).sort((a, b) => b.createdAt - a.createdAt)
}

export async function findDocumentByHash(hash: string): Promise<StoredDocument | undefined> {
  return (await database()).getFromIndex('documents', 'by-hash', hash)
}

export async function saveDocument(document: StoredDocument): Promise<void> {
  await (await database()).put('documents', document)
}

export async function saveChunks(chunks: SourceChunk[]): Promise<void> {
  const tx = (await database()).transaction('chunks', 'readwrite')
  await Promise.all([...chunks.map((chunk) => tx.store.put(chunk)), tx.done])
}

export async function listChunks(): Promise<SourceChunk[]> {
  return (await database()).getAll('chunks')
}

export async function deleteDocumentAndChunks(documentId: string): Promise<void> {
  const db = await database()
  const tx = db.transaction(['documents', 'chunks'], 'readwrite')
  const chunkIds = await tx.objectStore('chunks').index('by-document').getAllKeys(documentId)
  await Promise.all([
    tx.objectStore('documents').delete(documentId),
    ...chunkIds.map((id) => tx.objectStore('chunks').delete(id)),
  ])
  await tx.done
}

export async function clearApplicationData(): Promise<void> {
  const db = await database()
  const tx = db.transaction(['documents', 'chunks'], 'readwrite')
  await Promise.all([tx.objectStore('documents').clear(), tx.objectStore('chunks').clear()])
  await tx.done
}
