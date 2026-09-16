import { getLlamadasGlobal } from '@/lib/actions/llamadas'
import { LlamadasGlobal } from '@/components/llamadas/llamadas-global'

// La misma fuente que la pestaña Llamadas del cliente (agendas + grabaciones
// sin agenda + legado). Antes leía sales_calls y cargaba todos los leads de
// todos los clientes para el formulario, en cada visita.
const DIAS = 60

export default async function CallsPage() {
  const datos = await getLlamadasGlobal(DIAS)
  return <LlamadasGlobal datos={datos} desde={datos.desde} />
}
