'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/client'

function StatusBadge({ risk }: { risk: string }) {
  const colorMap: Record<string, string> = {
    green: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    yellow: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    red: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  }
  const classes = colorMap[risk] || 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${classes}`}>
      {risk.toUpperCase()}
    </span>
  )
}

// Placeholder chat until WhatsApp messages are actually persisted (see AiMessageQueue).
const MOCK_MESSAGES = [
  { id: 1, sender: 'bot', text: '¡Hola! Bienvenida al programa. ¿Estás lista para empezar?', time: '10:00 AM' },
  { id: 2, sender: 'client', text: '¡Hola! Sí, súper lista. Ya llené el formulario.', time: '10:05 AM' },
  { id: 3, sender: 'bot', audio: true, time: '10:10 AM' },
]

function StudentDetail({ student, onBack }: { student: any; onBack: () => void }) {
  return (
    <div className="stagger-children space-y-6">
      <div>
        <button onClick={onBack} className="text-sm text-zinc-400 hover:text-white transition-colors mb-2 inline-block">
          ← Volver al listado
        </button>
        <h2 className="text-xl font-semibold tracking-tight text-white/90">{student.full_name}</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Día {student.current_day} del programa • Ingreso: {new Date(student.start_date).toLocaleDateString()}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Roadmap de Producto</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <span className="text-sm font-medium text-emerald-400">Onboarding completado</span>
                <span className="text-emerald-500">✓</span>
              </div>

              <div className="space-y-2">
                <h3 className="text-xs uppercase font-medium text-zinc-500">Fotos de Diagnóstico</h3>
                <div className="grid grid-cols-3 gap-2">
                  <div className="aspect-square bg-white/5 rounded-md flex items-center justify-center text-xs text-zinc-500">Frente</div>
                  <div className="aspect-square bg-white/5 rounded-md flex items-center justify-center text-xs text-zinc-500">Perfil L</div>
                  <div className="aspect-square bg-white/5 rounded-md flex items-center justify-center text-xs text-zinc-500">Perfil R</div>
                </div>
              </div>

              <div className="pt-4 border-t border-white/10">
                <button className="w-full py-2 px-4 bg-amber-500 hover:bg-amber-600 text-amber-950 font-medium rounded-lg text-sm transition-colors shadow-lg shadow-amber-500/20">
                  Generar y Enviar Dossier
                </button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card className="h-[600px] flex flex-col">
            <CardHeader className="border-b border-white/5 pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  WhatsApp Chat
                </CardTitle>
                <span className="text-xs text-zinc-500">{student.phone}</span>
              </div>
            </CardHeader>
            <CardContent className="flex-1 p-0 flex flex-col">
              <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                {MOCK_MESSAGES.map((msg) => (
                  <div key={msg.id} className={`flex flex-col ${msg.sender === 'client' ? 'items-start' : 'items-end'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                      msg.sender === 'client'
                        ? 'bg-zinc-800 text-white/90 rounded-tl-none'
                        : 'bg-emerald-600 text-white rounded-tr-none'
                    }`}>
                      {msg.audio ? (
                        <div className="flex items-center gap-2">
                          <span>▶️ Audio (IA)</span>
                        </div>
                      ) : (
                        <p className="text-sm">{msg.text}</p>
                      )}
                    </div>
                    <span className="text-[10px] text-zinc-500 mt-1">{msg.time}</span>
                  </div>
                ))}
              </div>
              <div className="p-4 border-t border-white/5 bg-black/20">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Escribe un mensaje a la alumna..."
                    className="flex-1 bg-white/5 border border-white/10 rounded-full px-4 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-500 transition-shadow"
                  />
                  <button className="p-2 rounded-full bg-amber-500 text-amber-950 hover:bg-amber-600 transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

export function ProductTab({ clientId }: { clientId: string }) {
  const [students, setStudents] = useState<any[]>([])
  const [pendingMessages, setPendingMessages] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedStudent, setSelectedStudent] = useState<any | null>(null)

  useEffect(() => {
    async function loadData() {
      const supabase = createClient()

      const { data: stdData } = await supabase
        .from('program_students')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })

      setStudents(stdData || [])

      const { data: msgData } = await supabase
        .from('ai_messages_queue')
        .select('*, program_students!inner(full_name, client_id)')
        .eq('status', 'pending')
        .eq('program_students.client_id', clientId)
        .order('generated_at', { ascending: false })

      setPendingMessages(msgData || [])
      setLoading(false)
    }
    loadData()
  }, [clientId])

  if (loading) {
    return <div className="text-sm text-zinc-500 animate-pulse">Cargando datos del producto...</div>
  }

  if (selectedStudent) {
    return <StudentDetail student={selectedStudent} onBack={() => setSelectedStudent(null)} />
  }

  return (
    <div className="stagger-children space-y-6">
      {pendingMessages.length > 0 && (
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="text-amber-400 flex items-center gap-2">
              <span>Bandeja de Aprobación IA</span>
              <span className="bg-amber-500 text-amber-950 px-2 py-0.5 rounded-full text-xs">{pendingMessages.length} pendientes</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {pendingMessages.map((msg: any) => (
                <div key={msg.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-lg bg-black/20 border border-white/5 gap-4">
                  <div className="space-y-1 flex-1">
                    <p className="text-sm font-medium text-white/90">Para: {msg.program_students?.full_name}</p>
                    <p className="text-xs text-zinc-400 italic">"{msg.message_text}"</p>
                    {msg.audio_url && (
                      <audio controls className="h-8 mt-2 max-w-full">
                        <source src={msg.audio_url} type="audio/ogg" />
                      </audio>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button className="px-3 py-1.5 text-xs font-medium rounded-md bg-white/5 hover:bg-white/10 text-white transition-colors">
                      Rechazar
                    </button>
                    <button className="px-3 py-1.5 text-xs font-medium rounded-md bg-amber-500 hover:bg-amber-600 text-amber-950 transition-colors">
                      Aprobar y Enviar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Control de Alumnas - Avance del Programa</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead className="text-xs uppercase text-zinc-500 border-b border-white/10">
                <tr>
                  <th className="px-4 py-3 font-medium">Alumna</th>
                  <th className="px-4 py-3 font-medium">Fecha de Ingreso</th>
                  <th className="px-4 py-3 font-medium">Día Actual</th>
                  <th className="px-4 py-3 font-medium">Semáforo</th>
                  <th className="px-4 py-3 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {students.map((student: any) => (
                  <tr key={student.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3 font-medium text-white/90">{student.full_name}</td>
                    <td className="px-4 py-3 text-zinc-400">{new Date(student.start_date).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-zinc-400">Día {student.current_day}</td>
                    <td className="px-4 py-3">
                      <StatusBadge risk={student.risk_level} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setSelectedStudent(student)}
                        className="text-amber-400 hover:text-amber-300 font-medium text-xs transition-colors"
                      >
                        Ver Detalle & Chat →
                      </button>
                    </td>
                  </tr>
                ))}
                {students.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                      No hay alumnas registradas todavía.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
