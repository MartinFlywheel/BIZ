import Link from 'next/link'

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[#0B0B0B] text-zinc-300 py-16 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-semibold text-zinc-50 mb-8">Términos y Condiciones de Uso</h1>
        
        <div className="space-y-6 text-sm leading-relaxed">
          <section>
            <h2 className="text-xl font-medium text-zinc-100 mb-3">1. Aceptación de los Términos</h2>
            <p>
              Al acceder y utilizar la plataforma BIZ CRM ("el Servicio"), usted acepta estar sujeto a estos Términos y Condiciones. Si no está de acuerdo con alguna parte de estos términos, no podrá acceder al Servicio.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium text-zinc-100 mb-3">2. Uso Aceptable</h2>
            <p>
              Usted se compromete a utilizar el Servicio únicamente para fines lícitos y de acuerdo con estos Términos. Está prohibido:
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Utilizar el Servicio de cualquier manera que viole leyes o regulaciones locales, nacionales o internacionales aplicables.</li>
              <li>Enviar mensajes no solicitados (spam) a través de nuestras integraciones de mensajería (ej. Instagram).</li>
              <li>Intentar interferir o comprometer la integridad o seguridad del sistema.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-medium text-zinc-100 mb-3">3. Propiedad de los Datos</h2>
            <p>
              Usted retiene todos los derechos sobre los datos, información y materiales que ingrese en el Servicio. Al utilizar la plataforma, nos otorga una licencia limitada para procesar, almacenar y transmitir dichos datos únicamente con el fin de proveerle el Servicio.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium text-zinc-100 mb-3">4. Integración con Terceros</h2>
            <p>
              El Servicio se integra con plataformas de terceros (como Meta / Instagram). Usted acepta cumplir con los términos de servicio y políticas de uso de dichas plataformas de terceros. No somos responsables por interrupciones, cambios de políticas o suspensión de acceso por parte de estos terceros.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium text-zinc-100 mb-3">5. Limitación de Responsabilidad</h2>
            <p>
              En la máxima medida permitida por la ley, BIZ CRM no será responsable de ningún daño indirecto, incidental, especial, consecuente o punitivo, incluyendo sin limitación, pérdida de beneficios, datos, uso, fondo de comercio u otras pérdidas intangibles, resultantes de su acceso o uso o de la imposibilidad de acceder o utilizar el Servicio.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium text-zinc-100 mb-3">6. Cambios a los Términos</h2>
            <p>
              Nos reservamos el derecho de modificar o reemplazar estos Términos en cualquier momento. Los cambios entrarán en vigencia inmediatamente después de su publicación en esta página. Es su responsabilidad revisar estos Términos periódicamente.
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
