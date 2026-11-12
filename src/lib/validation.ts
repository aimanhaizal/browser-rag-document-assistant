import { MAX_FILE_BYTES, SUPPORTED_EXTENSIONS } from './constants'

export function extensionOf(name: string): string {
  return name.toLowerCase().split('.').pop() ?? ''
}

export function validateFile(file: File): void {
  const extension = extensionOf(file.name)
  if (!SUPPORTED_EXTENSIONS.includes(extension as (typeof SUPPORTED_EXTENSIONS)[number])) {
    throw new Error('Unsupported file type. Choose a PDF, DOCX, TXT, Markdown, or MD file.')
  }
  if (file.size === 0) throw new Error('The file is empty.')
  if (file.size > MAX_FILE_BYTES) throw new Error('The file exceeds the 25 MB version 1 limit.')
}
