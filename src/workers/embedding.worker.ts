/// <reference lib="webworker" />
import { env, pipeline } from '@huggingface/transformers'
import { EMBEDDING_MODEL } from '../lib/constants'

env.allowLocalModels = false
env.useBrowserCache = true

type Embedder = (inputs: string[], options: { pooling: 'mean'; normalize: boolean }) => Promise<{ tolist(): number[][] }>
let embedder: Embedder | undefined

async function initialize(requestId: string) {
  if (!embedder) {
    embedder = await pipeline('feature-extraction', EMBEDDING_MODEL, {
      dtype: 'q8',
      progress_callback: (progress: unknown) => {
        self.postMessage({ type: 'progress', requestId, progress })
      },
    }) as unknown as Embedder
  }
}

self.onmessage = async (event: MessageEvent<{ type: 'init' | 'embed'; requestId: string; texts?: string[] }>) => {
  const { type, requestId, texts = [] } = event.data
  try {
    await initialize(requestId)
    if (type === 'init') {
      self.postMessage({ type: 'ready', requestId })
    } else {
      const output = await embedder!(texts, { pooling: 'mean', normalize: true })
      self.postMessage({ type: 'result', requestId, vectors: output.tolist() })
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId,
      error: error instanceof Error ? error.message : 'Embedding failed.',
    })
  }
}
