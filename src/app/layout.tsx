import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'BIZ — CRM',
  description: 'CRM para agencia de marketing',
  manifest: '/manifest.webmanifest',
  // No explicit `icons` field here on purpose — Next.js auto-detects
  // app/icon.svg (browser-tab favicon) and app/apple-icon.png (iOS
  // home-screen icon) via file convention. Declaring `icons` at all here,
  // even just for `apple`, was suppressing that auto-detection and
  // silently dropped the site's real favicon from every page's <head>.
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'BIZ Setter',
  },
}

export const viewport: Viewport = {
  themeColor: '#0B0B0B',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" className={`${inter.variable} h-full antialiased`}>
      <body className="h-full bg-black text-white/90 font-sans">
        {children}
      </body>
    </html>
  )
}
