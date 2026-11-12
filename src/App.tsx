import { useEffect, useRef, useState } from 'react'
import type { ChatMessage, ProgressState, RetrievedChunk, SourceChunk, StoredDocument } from './types'
import { EMBEDDING_MODEL, GENERATION_MODEL, MIN_RELEVANCE_SCORE } from './lib/constants'
import { chunkPages } from './lib/chunking'
import { clearApplicationData, deleteDocumentAndChunks, findDocumentByHash, listChunks, listDocuments, saveChunks, saveDocument } from './lib/db'
import { embedTexts } from './lib/embedding'
import { extractDocument } from './lib/extraction'
import { validateFile } from './lib/validation'
import { hashFile } from './lib/hash'
import { generateGroundedAnswer, hasWebGpu, initializeLlm, isGenerationModelSupported, unloadLlm } from './lib/llm'
import { retrieveChunks } from './lib/retrieval'

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return fallback
}

function ProgressBar({ progress }: { progress: ProgressState }) {
  return (
    <div className="progress-wrap" aria-live="polite">
      <div className="progress-meta"><span>{progress.label}</span><span>{Math.round(progress.value * 100)}%</span></div>
      <div className="progress-track"><span style={{ width: `${Math.max(2, progress.value * 100)}%` }} /></div>
    </div>
  )
}

function DocumentRow({ document, onRemove }: { document: StoredDocument; onRemove: () => void }) {
  return (
    <article className="document-row">
      <div className="file-mark">{document.name.split('.').pop()?.slice(0, 4).toUpperCase()}</div>
      <div className="document-copy">
        <strong title={document.name}>{document.name}</strong>
        <span>{formatBytes(document.size)} · {document.chunkCount} passages</span>
        {document.error && <small className="error-text">{document.error}</small>}
      </div>
      <span className={`status-dot ${document.status}`} title={document.status} />
      <button className="icon-button" onClick={onRemove} aria-label={`Remove ${document.name}`}>×</button>
    </article>
  )
}

function SourceCard({ source }: { source: RetrievedChunk }) {
  return (
    <details className="source-card">
      <summary>
        <span className="source-id">{source.citationId}</span>
        <span><strong>{source.documentName}</strong>{source.page ? ` · page ${source.page}` : ''}</span>
        <span className="score">{Math.round(source.score * 100)}%</span>
      </summary>
      <p>{source.text}</p>
    </details>
  )
}

export default function App() {
  const [documents, setDocuments] = useState<StoredDocument[]>([])
  const [chunks, setChunks] = useState<SourceChunk[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [question, setQuestion] = useState('')
  const [progress, setProgress] = useState<ProgressState | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [modelStatus, setModelStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [aboutOpen, setAboutOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const chatEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    Promise.all([listDocuments(), listChunks()]).then(([storedDocuments, storedChunks]) => {
      setDocuments(storedDocuments)
      setChunks(storedChunks)
    }).catch((error) => setNotice(`Could not open browser storage: ${error.message}`))
  }, [])

  useEffect(() => {
    const target = chatEnd.current
    if (typeof target?.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  const updateDocument = (document: StoredDocument) => {
    setDocuments((current) => [document, ...current.filter((item) => item.id !== document.id)])
  }

  async function processFiles(files: File[]) {
    if (!files.length || busy) return
    setBusy(true)
    setNotice('')
    for (const file of files) {
      let record: StoredDocument | undefined
      try {
        validateFile(file)
        setProgress({ label: `Checking ${file.name}`, value: 0.04 })
        const hash = await hashFile(file)
        const duplicate = await findDocumentByHash(hash)
        if (duplicate?.status === 'ready') {
          setNotice(`${file.name} is already indexed.`)
          continue
        }
        const now = Date.now()
        record = {
          id: duplicate?.id ?? crypto.randomUUID(), hash, name: file.name, size: file.size,
          mimeType: file.type, status: 'processing', createdAt: duplicate?.createdAt ?? now,
          updatedAt: now, charCount: 0, chunkCount: 0,
        }
        await saveDocument(record)
        updateDocument(record)
        setProgress({ label: `Extracting ${file.name}`, value: 0.12 })
        const pages = await extractDocument(file)
        const textChunks = chunkPages(pages)
        if (!textChunks.length) throw new Error('No indexable text passages were produced.')
        setProgress({ label: 'Preparing the local embedding model', value: 0.2 })
        const vectors = await embedTexts(textChunks.map((chunk) => chunk.text), (label, value) => {
          setProgress({ label, value: 0.2 + value * 0.72 })
        })
        const storedChunks: SourceChunk[] = textChunks.map((chunk, index) => ({
          id: `${record!.id}:${index}`, documentId: record!.id, documentName: record!.name,
          index, page: chunk.page, text: chunk.text, embedding: vectors[index],
        }))
        await saveChunks(storedChunks)
        record = {
          ...record, status: 'ready', updatedAt: Date.now(), chunkCount: storedChunks.length,
          charCount: pages.reduce((sum, page) => sum + page.text.length, 0),
        }
        await saveDocument(record)
        updateDocument(record)
        setChunks((current) => [...current.filter((chunk) => chunk.documentId !== record!.id), ...storedChunks])
        setProgress({ label: `${file.name} indexed`, value: 1 })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Document processing failed.'
        setNotice(`${file.name}: ${message}`)
        if (record) {
          const failed = { ...record, status: 'error' as const, error: message, updatedAt: Date.now() }
          await saveDocument(failed)
          updateDocument(failed)
        }
      }
    }
    setBusy(false)
    window.setTimeout(() => setProgress(null), 900)
  }

  async function removeDocument(document: StoredDocument) {
    await deleteDocumentAndChunks(document.id)
    setDocuments((current) => current.filter((item) => item.id !== document.id))
    setChunks((current) => current.filter((chunk) => chunk.documentId !== document.id))
  }

  async function loadGenerationModel() {
    if (modelStatus === 'ready' || modelStatus === 'loading') return
    setNotice('')
    setModelStatus('loading')
    try {
      await initializeLlm((label, value) => setProgress({ label, value }))
      setModelStatus('ready')
      setProgress(null)
    } catch (error) {
      setModelStatus('error')
      setProgress(null)
      const message = errorMessage(error, 'The local model could not be loaded.')
      setNotice(message)
      throw new Error(message)
    }
  }

  async function askQuestion(event: React.FormEvent) {
    event.preventDefault()
    const prompt = question.trim()
    if (!prompt || busy) return
    if (!chunks.length) {
      setNotice('Index at least one document before asking a question.')
      return
    }
    setQuestion('')
    setNotice('')
    setBusy(true)
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', text: prompt, createdAt: Date.now() }
    setMessages((current) => [...current, userMessage])
    let assistantId: string | undefined
    try {
      setProgress({ label: 'Embedding your question locally', value: 0.15 })
      const [queryVector] = await embedTexts([prompt], (label, value) => setProgress({ label, value: value * 0.4 }))
      if (!queryVector?.length) {
        throw new Error('The local embedding model did not return a query vector. Reload the page and try again.')
      }
      const compatibleChunks = chunks.filter((chunk) => chunk.embedding?.length === queryVector.length)
      if (!compatibleChunks.length) {
        throw new Error('The stored document index is incomplete or incompatible. Remove and re-index the document, then try again.')
      }
      const sources = retrieveChunks(compatibleChunks, queryVector)
      assistantId = crypto.randomUUID()
      if (!sources.length || sources[0].score < MIN_RELEVANCE_SCORE) {
        setMessages((current) => [...current, {
          id: assistantId!, role: 'assistant', createdAt: Date.now(),
          text: 'I could not find enough information in the indexed documents.', sources: [],
        }])
        return
      }
      setMessages((current) => [...current, {
        id: assistantId!, role: 'assistant', createdAt: Date.now(),
        text: 'Relevant passages retrieved. Loading the local generation model…', sources,
      }])
      if (modelStatus !== 'ready') await loadGenerationModel()
      setProgress({ label: 'Generating on your device', value: 0.9 })
      setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, text: '' } : message))
      const answer = await generateGroundedAnswer(prompt, sources, (text) => {
        setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, text } : message))
      })
      setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, text: answer, sources } : message))
    } catch (error) {
      const message = errorMessage(error, 'Question answering failed.')
      setNotice(message)
      if (assistantId) {
        setMessages((current) => current.map((item) => item.id === assistantId
          ? { ...item, text: `Relevant passages were retrieved, but local generation could not start: ${message}` }
          : item))
      }
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  async function clearEverything() {
    if (!window.confirm('Delete all indexed documents, embeddings, chat messages, and cached model files for this site?')) return
    await clearApplicationData()
    await unloadLlm()
    if ('caches' in window) {
      const cacheNames = await caches.keys()
      await Promise.all(cacheNames.map((name) => caches.delete(name)))
    }
    setDocuments([])
    setChunks([])
    setMessages([])
    setModelStatus('idle')
    setNotice('Local application data was cleared.')
  }

  const readyDocuments = documents.filter((document) => document.status === 'ready').length

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="LocalDoc AI home">
          <span className="brand-glyph">L</span>
          <span><strong>LocalDoc</strong> AI</span>
        </a>
        <div className="privacy-badge"><span /> Private by design · on-device only</div>
        <button className="text-button" onClick={() => setAboutOpen(true)}>Settings & about</button>
      </header>

      <main id="top" className="workspace">
        <aside className="library-panel">
          <div className="section-heading">
            <div><span className="eyebrow">01 / LIBRARY</span><h1>Your sources</h1></div>
            <span className="count-badge">{readyDocuments}</span>
          </div>

          <div
            className={`dropzone ${dragging ? 'dragging' : ''}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault(); setDragging(false); void processFiles([...event.dataTransfer.files])
            }}
          >
            <input
              ref={fileInput} type="file" multiple hidden accept=".pdf,.docx,.txt,.md,.markdown"
              onChange={(event) => void processFiles([...(event.target.files ?? [])])}
            />
            <span className="upload-icon">↥</span>
            <strong>Drop documents here</strong>
            <span>PDF, DOCX, TXT or Markdown · up to 25 MB</span>
            <button className="primary-button" onClick={() => fileInput.current?.click()} disabled={busy}>Choose files</button>
          </div>

          {progress && <ProgressBar progress={progress} />}
          {notice && <div className="notice" role="alert">{notice}</div>}

          <div className="document-list">
            {documents.length === 0 ? (
              <div className="empty-library"><span>NO DOCUMENTS</span><p>Files stay in this browser. Add a source to begin building your private index.</p></div>
            ) : documents.map((document) => (
              <DocumentRow key={document.id} document={document} onRemove={() => void removeDocument(document)} />
            ))}
          </div>

          <div className="local-note">
            <span className="shield">◇</span>
            <p><strong>Nothing leaves this device.</strong><br />Only model files are downloaded. Your content and questions are never uploaded.</p>
          </div>
        </aside>

        <section className="chat-panel">
          <div className="chat-heading">
            <div><span className="eyebrow">02 / ASK</span><h2>Document conversation</h2></div>
            <div className={`model-state ${modelStatus}`}>
              <span /> {modelStatus === 'ready' ? 'Model ready' : modelStatus === 'loading' ? 'Loading model' : modelStatus === 'error' ? 'Model unavailable' : 'Model on demand'}
            </div>
          </div>

          <div className="chat-scroll">
            {messages.length === 0 ? (
              <div className="chat-empty">
                <div className="monogram">LD</div>
                <span className="eyebrow">GROUNDED ANSWERS</span>
                <h2>Ask what your documents know.</h2>
                <p>LocalDoc retrieves relevant passages, then asks a compact language model running on your GPU to answer from those sources only.</p>
                <div className="starter-grid">
                  <button onClick={() => setQuestion('Summarize the main ideas across my documents.')}>Summarize the main ideas <span>→</span></button>
                  <button onClick={() => setQuestion('What facts do the documents provide about the central topic?')}>Find key facts <span>→</span></button>
                </div>
              </div>
            ) : messages.map((message) => (
              <article key={message.id} className={`message ${message.role}`}>
                <div className="message-label">{message.role === 'user' ? 'YOU' : 'LOCALDOC'}</div>
                <div className="message-body">
                  <p>{message.text || <span className="typing">Generating locally…</span>}</p>
                  {!!message.sources?.length && (
                    <div className="sources">
                      <h3>Retrieved evidence · {message.sources.length} passages</h3>
                      {message.sources.map((source) => <SourceCard key={source.id} source={source} />)}
                    </div>
                  )}
                </div>
              </article>
            ))}
            <div ref={chatEnd} />
          </div>

          <form className="composer" onSubmit={askQuestion}>
            <label htmlFor="question">Ask across {readyDocuments || 'your'} indexed document{readyDocuments === 1 ? '' : 's'}</label>
            <div className="composer-row">
              <textarea
                id="question" value={question} rows={2} disabled={busy}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() }
                }}
                placeholder="What would you like to know?"
              />
              <button type="submit" aria-label="Ask question" disabled={busy || !question.trim()}>→</button>
            </div>
            <small>Enter to send · Shift + Enter for a new line</small>
          </form>
        </section>
      </main>

      <footer><span>LocalDoc AI · Open source browser RAG</span><span>IndexedDB storage may be evicted; keep original files as your backup.</span></footer>

      {aboutOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setAboutOpen(false)}>
          <section className="about-modal" role="dialog" aria-modal="true" aria-labelledby="about-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setAboutOpen(false)} aria-label="Close">×</button>
            <span className="eyebrow">SETTINGS & ABOUT</span>
            <h2 id="about-title">Local means local.</h2>
            <p>Extraction, embeddings, retrieval, questions, and answers are processed in this browser. There is no account, application server, analytics pipeline, or cloud document store.</p>
            <dl>
              <div><dt>Embedding model</dt><dd>{EMBEDDING_MODEL} · Apache-2.0 · quantized ONNX</dd></div>
              <div><dt>Generation model</dt><dd>{GENERATION_MODEL} · Apache-2.0 · q4f16_1</dd></div>
              <div><dt>WebGPU</dt><dd>{hasWebGpu() ? 'Available in this browser' : 'Not available — local generation is disabled'}</dd></div>
              <div><dt>Runtime support</dt><dd>{isGenerationModelSupported() ? 'Model is registered in this WebLLM build' : 'Configured model is not registered'}</dd></div>
            </dl>
            <div className="about-callout"><strong>First use</strong><p>The generation model download is approximately 350–450 MB and is cached by your browser. Loading can use around 1 GB of GPU memory.</p></div>
            <p className="fine-print">Browser storage is not a permanent backup and may be evicted. Scanned PDFs are unsupported because version 1 does not include OCR. A network connection is required only to download model assets.</p>
            <button className="danger-button" onClick={() => void clearEverything()}>Clear all local data</button>
          </section>
        </div>
      )}
    </div>
  )
}
