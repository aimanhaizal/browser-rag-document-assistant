type ProgressCallback = (label: string, value: number) => void

interface PendingRequest {
  resolve: (value: Float32Array[]) => void
  reject: (error: Error) => void
  onProgress?: ProgressCallback
}

let worker: Worker | undefined
const pending = new Map<string, PendingRequest>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('../workers/embedding.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event) => {
    const message = event.data
    const request = pending.get(message.requestId)
    if (!request) return
    if (message.type === 'progress') {
      const progress = message.progress ?? {}
      const value = typeof progress.progress === 'number' ? progress.progress / 100 : 0
      request.onProgress?.(progress.file ? `Downloading ${progress.file}` : 'Loading embedding model', value)
    } else if (message.type === 'ready') {
      request.resolve([])
      pending.delete(message.requestId)
    } else if (message.type === 'result') {
      request.resolve(message.vectors.map((vector: number[]) => new Float32Array(vector)))
      pending.delete(message.requestId)
    } else if (message.type === 'error') {
      request.reject(new Error(message.error))
      pending.delete(message.requestId)
    }
  }
  return worker
}

function requestWorker(
  type: 'init' | 'embed',
  texts: string[],
  onProgress?: ProgressCallback,
): Promise<Float32Array[]> {
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject, onProgress })
    getWorker().postMessage({ type, requestId, texts })
  })
}

export async function initializeEmbeddingModel(onProgress?: ProgressCallback): Promise<void> {
  await requestWorker('init', [], onProgress)
}

export async function embedTexts(
  texts: string[],
  onProgress?: ProgressCallback,
): Promise<Float32Array[]> {
  const vectors: Float32Array[] = []
  const batchSize = 16
  for (let start = 0; start < texts.length; start += batchSize) {
    const batch = texts.slice(start, start + batchSize)
    vectors.push(...(await requestWorker('embed', batch, onProgress)))
    onProgress?.('Generating embeddings', Math.min(1, (start + batch.length) / texts.length))
  }
  return vectors
}
