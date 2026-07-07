import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'BIZ — CRM',
  description: 'CRM para agencia de marketing',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="h-full bg-black text-white/90 font-sans">
        {children}
      </body>
    </html>
  )
}
