'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { bulkImportInteractionsAction } from '@/lib/actions/interactions'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Upload, CheckCircle, AlertCircle } from 'lucide-react'
import type { InteractionClassification } from '@/lib/types'

interface Props {
  clientId: string
}

interface ParsedRow {
  ig_username?: string
  prospect_name?: string
  classification: InteractionClassification
  keyword_used?: string
  bot_triggered_at?: string
}

export function CsvImport({ clientId }: Props) {
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)
  const router = useRouter()

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      const lines = text.split('\n').filter(Boolean)
      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase())

      const parsed: ParsedRow[] = []
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map((v) => v.trim())
        const row: Record<string, string> = {}
        headers.forEach((h, idx) => { row[h] = values[idx] || '' })

        const classification = (row.classification || row.clasificacion || 'chat_abierto') as InteractionClassification
        if (!['chat_abierto', 'conversacion_real', 'disqualified'].includes(classification)) continue

        parsed.push({
          ig_username: row.ig_username || row.username || undefined,
          prospect_name: row.prospect_name || row.nombre || undefined,
          classification,
          keyword_used: row.keyword_used || row.keyword || undefined,
          bot_triggered_at: row.bot_triggered_at || row.fecha || undefined,
        })
      }

      setRows(parsed)
      setResult(null)
    }
    reader.readAsText(file)
  }

  async function handleImport() {
    if (rows.length === 0) return
    setImporting(true)
    try {
      await bulkImportInteractionsAction(clientId, rows)
      setResult({ success: true, message: `${rows.length} interacciones importadas` })
      setRows([])
      router.refresh()
    } catch {
      setResult({ success: false, message: 'Error al importar' })
    }
    setImporting(false)
  }

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <Upload className="h-4 w-4 text-zinc-400" />
        <div>
          <p className="text-sm font-medium text-zinc-200">Importar CSV</p>
          <p className="text-xs text-zinc-500">
            Columnas: ig_username, prospect_name, classification, keyword_used, bot_triggered_at
          </p>
        </div>
      </div>

      <input
        type="file"
        accept=".csv"
        onChange={handleFile}
        className="block w-full text-sm text-zinc-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border file:border-zinc-700 file:bg-zinc-800 file:text-sm file:text-zinc-200 hover:file:bg-zinc-700"
      />

      {rows.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-zinc-300">{rows.length} filas detectadas</p>
          <div className="max-h-32 overflow-y-auto rounded border border-zinc-800 p-2 text-xs text-zinc-400">
            {rows.slice(0, 5).map((r, i) => (
              <div key={i}>{r.ig_username || r.prospect_name} — {r.classification} — {r.keyword_used || 'sin keyword'}</div>
            ))}
            {rows.length > 5 && <div>... y {rows.length - 5} más</div>}
          </div>
          <Button onClick={handleImport} disabled={importing} size="sm">
            {importing ? 'Importando...' : `Importar ${rows.length} filas`}
          </Button>
        </div>
      )}

      {result && (
        <div className={`flex items-center gap-2 text-sm ${result.success ? 'text-emerald-400' : 'text-red-400'}`}>
          {result.success ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {result.message}
        </div>
      )}
    </Card>
  )
}
