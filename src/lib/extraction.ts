import * as pdfjs from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import * as mammoth from 'mammoth/mammoth.browser'
import { MAX_EXTRACTED_CHARS } from './constants'
import { extensionOf, validateFile } from './validation'
import type { ExtractionPage } from '../types'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

async function extractPdf(file: File): Promise<ExtractionPage[]> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') {
    throw new Error('This file does not have a valid PDF header.')
  }
  try {
    const pdf = await pdfjs.getDocument({ data: bytes }).promise
    const pages: ExtractionPage[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (text) pages.push({ page: pageNumber, text })
    }
    if (pages.length === 0) {
      throw new Error('No extractable text was found. This may be a scanned PDF; OCR is not supported in version 1.')
    }
    return pages
  } catch (error) {
    if (error instanceof Error && /password/i.test(`${error.name} ${error.message}`)) {
      throw new Error('Encrypted or password-protected PDFs are not supported.')
    }
    throw error
  }
}

async function extractDocx(file: File): Promise<ExtractionPage[]> {
  const buffer = await file.arrayBuffer()
  const signature = new Uint8Array(buffer.slice(0, 2))
  if (signature[0] !== 0x50 || signature[1] !== 0x4b) {
    throw new Error('This file does not appear to be a valid DOCX archive.')
  }
  const result = await mammoth.extractRawText({ arrayBuffer: buffer })
  const text = result.value.replace(/\s+/g, ' ').trim()
  if (!text) throw new Error('No extractable text was found in this DOCX file.')
  return [{ text }]
}

async function extractPlainText(file: File): Promise<ExtractionPage[]> {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(await file.arrayBuffer()).trim()
  if (!text) throw new Error('No readable text was found in this file.')
  return [{ text }]
}

export async function extractDocument(file: File): Promise<ExtractionPage[]> {
  validateFile(file)
  const extension = extensionOf(file.name)
  let pages: ExtractionPage[]
  if (extension === 'pdf') pages = await extractPdf(file)
  else if (extension === 'docx') pages = await extractDocx(file)
  else pages = await extractPlainText(file)

  const totalChars = pages.reduce((sum, page) => sum + page.text.length, 0)
  if (totalChars > MAX_EXTRACTED_CHARS) {
    throw new Error('Extracted text exceeds the 2 million character version 1 limit.')
  }
  return pages
}
