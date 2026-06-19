'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { linkInstagramAccount, syncClientContent } from '@/lib/actions/instagram'
import { AtSign, RefreshCw, CalendarPlus, CheckCircle2, AlertCircle } from 'lucide-react'

import type { Client } from '@/lib/types'

interface Props {
    client: Client
    onLoadWeek: () => void
}

/**
 * Acciones Esenciales del Hub del Cliente.
 * Modelo simplificado: pegar Instagram Account ID + sincronizar contenido + cargar semana.
 * No usa OAuth — el sync corre con META_SYSTEM_USER_TOKEN en el backend.
 */
export function ClientActions({ client, onLoadWeek }: Props) {
    const router = useRouter()
    const [igId, setIgId] = useState(client.ig_account_id || '')
    const [savingId, setSavingId] = useState(false)
    const [syncing, setSyncing] = useState(false)
    const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

    function showToast(type: 'success' | 'error', message: string) {
        setToast({ type, message })
        setTimeout(() => setToast(null), 5000)
    }

    async function handleSaveId() {
        if (!igId.trim()) return
        setSavingId(true)
        try {
            await linkInstagramAccount(client.id, igId.trim())
            showToast('success', 'Instagram Account ID vinculado')
            router.refresh()
        } catch {
            showToast('error', 'No se pudo guardar el Account ID')
        } finally {
            setSavingId(false)
        }
    }

    async function handleSync() {
        setSyncing(true)
        try {
            const result = await syncClientContent(client.id)
            if (result.status === 'success') {
                showToast('success', result.message)
                router.refresh()
            } else {
                showToast('error', result.message)
            }
        } catch {
            showToast('error', 'Error al sincronizar contenido')
        } finally {
            setSyncing(false)
        }
    }

    const isLinked = Boolean(client.ig_account_id)

    return (
        <Card className="space-y-5">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <AtSign className="h-4 w-4 text-zinc-400" />

                    <h3 className="text-sm font-medium text-white/90">Acciones</h3>
                </div>
                {isLinked && (
                    <Badge variant="success">Vinculado vía System Token</Badge>
                )}
            </div>

            {toast && (
                <div className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${toast.type === 'success'
                    ? 'border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-300'
                    : 'border-red-500/20 bg-red-500/[0.06] text-red-300'
                    }`}>
                    {toast.type === 'success'
                        ? <CheckCircle2 className="h-4 w-4 shrink-0" />
                        : <AlertCircle className="h-4 w-4 shrink-0" />}
                    {toast.message}
                </div>
            )}

            {/* 1. Instagram Account ID */}
            <div className="flex items-end gap-2">
                <div className="flex-1">
                    <Input
                        id="ig_account_id"
                        label="Instagram Account ID"
                        placeholder="17841400000000000"
                        value={igId}
                        onChange={(e) => setIgId(e.target.value)}
                    />
                </div>
                <Button
                    onClick={handleSaveId}
                    disabled={savingId || !igId.trim() || igId.trim() === (client.ig_account_id || '')}
                >
                    {savingId ? 'Guardando...' : 'Guardar'}
                </Button>
            </div>

            {/* 2. Sincronizar Contenido + 3. Cargar Semana */}
            <div className="flex flex-wrap gap-3">
                <Button
                    variant="secondary"
                    onClick={handleSync}
                    disabled={syncing || !isLinked}
                    title={!isLinked ? 'Vincula primero el Instagram Account ID' : undefined}
                >
                    <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
                    {syncing ? 'Sincronizando...' : 'Sincronizar Contenido'}
                </Button>

                <Button variant="secondary" onClick={onLoadWeek}>
                    <CalendarPlus className="h-3.5 w-3.5" />
                    Cargar Semana
                </Button>
            </div>
        </Card>
    )
}
