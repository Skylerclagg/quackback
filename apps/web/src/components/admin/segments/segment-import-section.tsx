'use client'

import { useState, useRef, useCallback } from 'react'
import { z } from 'zod'
import Papa from 'papaparse'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpTrayIcon,
  ArrowDownTrayIcon,
  DocumentTextIcon,
  XMarkIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { invalidateSegmentQueries } from '@/lib/client/mutations'

const MAX_FILE_SIZE = 5 * 1024 * 1024
/** How many addresses to show in the pre-upload preview. */
const PREVIEW_SAMPLE_SIZE = 5

const CSV_TEMPLATE = 'email\nuser@example.com\n'

const errorResponseSchema = z.object({
  error: z.string().optional(),
})

const importResponseSchema = z.object({
  assigned: z.number(),
  matched: z.number(),
  unmatched: z.array(z.string()),
  unmatchedCount: z.number(),
  invalid: z.array(z.string()),
  invalidCount: z.number(),
  unmatchedTruncated: z.boolean(),
  total: z.number(),
})

type ImportResult = z.infer<typeof importResponseSchema>

type ImportState = 'idle' | 'uploading' | 'completed' | 'failed'

interface FilePreview {
  emails: string[]
  hasHeader: boolean
}

/**
 * Pull the email column out of a CSV client-side. Mirrors `extractEmails`
 * in routes/api/segments/import.ts so the preview count matches what the
 * server will actually read — a header row containing `email`, otherwise
 * a headerless single-column list.
 */
function extractEmails(csvText: string): FilePreview {
  const headered = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim().toLowerCase(),
  })

  const raw = (headered.meta.fields ?? []).includes('email')
    ? headered.data.map((row) => row.email ?? '')
    : Papa.parse<string[]>(csvText, { header: false, skipEmptyLines: true }).data.map(
        (row) => row?.[0] ?? ''
      )

  return {
    emails: raw.map((value) => value.trim()).filter((value) => value.length > 0),
    hasHeader: (headered.meta.fields ?? []).includes('email'),
  }
}

interface SegmentImportSectionProps {
  segmentId: string
  segmentName: string
}

/**
 * CSV bulk-add for manual segments. Renders as a standalone block inside
 * the edit dialog but deliberately *outside* its `<form>`: uploading is its
 * own action and must not be entangled with the Save button (nor nest a
 * form inside a form). Every control here is an explicit `type="button"`.
 */
export function SegmentImportSection({ segmentId, segmentName }: SegmentImportSectionProps) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<ImportState>('idle')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const clearFile = useCallback(() => {
    setSelectedFile(null)
    setPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleFileSelect = useCallback(
    async (file: File) => {
      setError(null)
      if (!file.type.includes('csv') && !file.name.endsWith('.csv')) {
        setError('Please select a CSV file')
        return
      }
      if (file.size > MAX_FILE_SIZE) {
        setError('File size must be less than 5MB')
        return
      }

      setSelectedFile(file)
      // Parse up front so the admin sees what we read out of their file
      // before anyone gets added to a segment.
      try {
        const parsed = extractEmails(await file.text())
        setPreview(parsed)
        if (parsed.emails.length === 0) {
          setError('No email addresses found. Expected an "email" column or one per line.')
        }
      } catch {
        setPreview(null)
        setError('Could not read that file')
      }
    },
    [setError]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files[0]
      if (file) void handleFileSelect(file)
    },
    [handleFileSelect]
  )

  const handleImport = async () => {
    if (!selectedFile) return

    setError(null)
    setState('uploading')

    try {
      const formData = new FormData()
      formData.append('file', selectedFile)
      formData.append('segmentId', segmentId)

      const response = await fetch('/api/segments/import', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const data = errorResponseSchema.parse(await response.json())
        throw new Error(data.error || 'Import failed')
      }

      setResult(importResponseSchema.parse(await response.json()))
      setState('completed')
      invalidateSegmentQueries(queryClient)
    } catch (err) {
      setState('failed')
      setError(err instanceof Error ? err.message : 'Import failed')
    }
  }

  const handleReset = () => {
    setState('idle')
    clearFile()
    setError(null)
    setResult(null)
  }

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'segment-members-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const canImport = !!selectedFile && !!preview && preview.emails.length > 0

  return (
    <div className="border-t border-border/60 pt-5 space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Import members</h3>
        <p className="text-xs text-muted-foreground">
          Upload a CSV of email addresses to add existing accounts to{' '}
          <span className="font-medium text-foreground">{segmentName}</span>. Addresses without an
          account are reported back, never invited.
        </p>
      </div>

      {state === 'idle' && (
        <>
          <div
            className="border-2 border-dashed border-border/50 rounded-lg p-6 text-center hover:border-primary/50 transition-colors cursor-pointer"
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && void handleFileSelect(e.target.files[0])}
            />
            {selectedFile ? (
              <div className="flex items-center justify-center gap-2">
                <DocumentTextIcon className="h-5 w-5 text-primary" />
                <span className="text-sm font-medium">{selectedFile.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove file"
                  onClick={(e) => {
                    e.stopPropagation()
                    setError(null)
                    clearFile()
                  }}
                >
                  <XMarkIcon className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            ) : (
              <>
                <ArrowUpTrayIcon className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  Drop a CSV file here or click to browse
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  An <code className="font-mono">email</code> column, or one address per line.
                  Maximum 5MB, up to 10,000 rows.
                </p>
              </>
            )}
          </div>

          {/* Client-side preview so the admin confirms what we parsed
           *  before anything is written. */}
          {preview && preview.emails.length > 0 && (
            <div className="bg-muted/40 rounded-lg p-3 text-xs space-y-1">
              <p className="font-medium text-foreground">
                {preview.emails.length} {preview.emails.length === 1 ? 'email' : 'emails'} found
                {preview.hasHeader ? '' : ' (no header row)'}
              </p>
              <ul className="text-muted-foreground font-mono space-y-0.5">
                {preview.emails.slice(0, PREVIEW_SAMPLE_SIZE).map((email, i) => (
                  <li key={i} className="truncate">
                    {email}
                  </li>
                ))}
              </ul>
              {preview.emails.length > PREVIEW_SAMPLE_SIZE && (
                <p className="text-muted-foreground">
                  ...and {preview.emails.length - PREVIEW_SAMPLE_SIZE} more
                </p>
              )}
            </div>
          )}

          {error && (
            <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-lg flex items-center gap-2">
              <ExclamationCircleIcon className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleImport}
              disabled={!canImport}
              className="w-full sm:w-auto"
            >
              <ArrowUpTrayIcon className="size-4" />
              Import members
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={downloadTemplate}
              className="w-full sm:w-auto"
            >
              <ArrowDownTrayIcon className="size-4" />
              Download template
            </Button>
          </div>
        </>
      )}

      {state === 'uploading' && (
        <div className="flex items-center gap-3">
          <ArrowPathIcon className="h-5 w-5 animate-spin text-primary" />
          <span className="text-sm font-medium">Matching emails to accounts...</span>
        </div>
      )}

      {state === 'completed' && result && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-primary">
            <CheckCircleIcon className="h-5 w-5" />
            <span className="font-medium text-sm">Import complete</span>
          </div>
          <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
            <p>
              <span className="font-medium">{result.assigned}</span>{' '}
              {result.assigned === 1 ? 'person' : 'people'} added from{' '}
              <span className="font-medium">{result.total}</span>{' '}
              {result.total === 1 ? 'row' : 'rows'}
            </p>

            {result.unmatchedCount > 0 && (
              <details>
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  {result.unmatchedCount} {result.unmatchedCount === 1 ? 'address' : 'addresses'}{' '}
                  with no account
                </summary>
                <ul className="mt-2 space-y-0.5 text-xs font-mono text-muted-foreground">
                  {result.unmatched.map((email, i) => (
                    <li key={i} className="truncate">
                      {email}
                    </li>
                  ))}
                  {result.unmatchedCount > result.unmatched.length && (
                    <li className="font-sans">
                      ...and {result.unmatchedCount - result.unmatched.length} more (list truncated)
                    </li>
                  )}
                </ul>
              </details>
            )}

            {result.invalidCount > 0 && (
              <details>
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  {result.invalidCount} invalid {result.invalidCount === 1 ? 'entry' : 'entries'}
                </summary>
                <ul className="mt-2 space-y-0.5 text-xs font-mono text-destructive">
                  {result.invalid.map((value, i) => (
                    <li key={i} className="truncate">
                      {value}
                    </li>
                  ))}
                  {result.invalidCount > result.invalid.length && (
                    <li className="font-sans">
                      ...and {result.invalidCount - result.invalid.length} more (list truncated)
                    </li>
                  )}
                </ul>
              </details>
            )}
          </div>
          <Button type="button" size="sm" variant="outline" onClick={handleReset}>
            Import another file
          </Button>
        </div>
      )}

      {state === 'failed' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-destructive">
            <ExclamationCircleIcon className="h-5 w-5" />
            <span className="font-medium text-sm">Import failed</span>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="button" size="sm" variant="outline" onClick={handleReset}>
            Try again
          </Button>
        </div>
      )}
    </div>
  )
}
