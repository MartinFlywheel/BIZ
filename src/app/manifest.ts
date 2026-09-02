import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    // El manifiesto define qué abre el ícono instalado, así que no puede estar
    // atado a un rol: la app móvil la usan los setters y también la dirección
    // (Fabián en ventas, Martín en marketing), y las tres pantallas ya se
    // adaptan a quién entra. Con el nombre anterior, instalarla desde la
    // cuenta de dirección dejaba un ícono que decía "Setter".
    name: 'BIZ CRM',
    short_name: 'BIZ',
    description: 'Leads, agendas y progreso del equipo desde el celular',
    start_url: '/setter-app',
    scope: '/',
    display: 'standalone',
    background_color: '#0B0B0B',
    theme_color: '#0B0B0B',
    orientation: 'portrait',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
