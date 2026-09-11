import { cn } from '@/lib/utils'

/**
 * Marca de la app: el mismo dibujo que el favicon de la pestaña.
 *
 * El original vive en `src/app/icon.svg` (y en `src/app/apple-icon.png` /
 * `public/icons/*` para PWA e iOS). Como Next.js sirve esos archivos por
 * convención y no se pueden importar como componente, este SVG es una copia
 * literal: si cambia el logo, hay que actualizar los dos.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      className={cn('shrink-0 overflow-hidden', className)}
    >
      <rect width="64" height="64" fill="#0a0a0a" />
      <text
        x="32"
        y="38"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="24"
        fontWeight="700"
        fill="#f4f4f5"
        letterSpacing="-0.5"
      >
        SG
      </text>
      <rect x="24" y="45" width="16" height="3" rx="1.5" fill="#b01021" />
    </svg>
  )
}
