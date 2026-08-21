import Link from 'next/link'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#0B0B0B] text-zinc-300 py-16 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-semibold text-zinc-50 mb-8">Política de Privacidad</h1>
        
        <div className="space-y-6 text-sm leading-relaxed">
          <section>
            <h2 className="text-xl font-medium text-zinc-100 mb-3">1. Recolección de Datos Personales</h2>
            <p>
              Recolectamos la siguiente información de los leads y contactos (usuarios de Instagram y otras plataformas) de nuestros clientes:
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Nombre y/o nombre de usuario de Instagram.</li>
              <li>Número de teléfono y correo electrónico (cuando son provistos voluntariamente).</li>
              <li>Contenido de los mensajes directos (DM) intercambiados con las cuentas de nuestros clientes.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-medium text-zinc-100 mb-3">2. Uso de la Información</h2>
            <p>
              Utilizamos los datos personales recolectados exclusivamente para:
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Gestión comercial de los clientes de la agencia.</li>
              <li>Seguimiento de ventas y procesos de conversión.</li>
              <li>Brindar soporte y atención al cliente en nombre de las cuentas administradas.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-medium text-zinc-100 mb-3">3. Compartición y Venta de Datos</h2>
            <p>
              <strong>No vendemos ni compartimos sus datos personales con terceros.</strong> La información solo se comparte con los proveedores de servicios estrictamente necesarios para operar nuestra plataforma, incluyendo:
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li><strong>Supabase:</strong> Utilizado para el almacenamiento seguro de la base de datos.</li>
              <li><strong>Meta / Instagram:</strong> Para habilitar el envío y recepción de mensajes directos.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-medium text-zinc-100 mb-3">4. Almacenamiento y Conservación</h2>
            <p>
              Los datos se almacenan en servidores seguros operados por nuestros proveedores de infraestructura (Supabase). Conservamos la información mientras sea necesaria para proveer el servicio a nuestros clientes (la agencia) o hasta que se solicite su eliminación.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium text-zinc-100 mb-3">5. Sus Derechos y Contacto</h2>
            <p>
              Usted tiene derecho a consultar, modificar o solicitar la baja (eliminación) de sus datos personales. Para ejercer estos derechos o realizar consultas sobre esta Política de Privacidad, por favor contáctenos a:
            </p>
            <p className="mt-2 font-medium text-zinc-50">contacto@agencia-ejemplo.com</p>
            <p className="mt-1 text-xs text-zinc-500 italic">
              (Nota: Reemplace este correo con el email de contacto real de su agencia)
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-zinc-800 text-center">
          <Link href="/login" className="text-sm text-zinc-400 hover:text-zinc-50 transition-colors">
            ← Volver al inicio
          </Link>
        </div>
      </div>
    </div>
  )
}
