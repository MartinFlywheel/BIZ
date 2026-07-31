'use client'

import React, { useEffect, useRef } from 'react'

export function ParticleNetwork() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Skip entirely below the sm breakpoint (this loop does up to ~100k
    // pairwise distance checks per frame — fine on a desktop GPU/CPU, not
    // something to run behind a phone's bottom nav bar) and when the user
    // has asked the OS for reduced motion.
    const isDesktop = window.matchMedia('(min-width: 640px)').matches
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!isDesktop || reducedMotion) return

    let width = window.innerWidth
    let height = window.innerHeight
    canvas.width = width
    canvas.height = height

    const particles: Particle[] = []
    // Connection cost is O(n^2) — 200 keeps that under ~20k pairs/frame
    // instead of the ~100k that 450 produced, without visibly thinning
    // the sphere.
    const particleCount = 200
    const sphereRadius = Math.min(width, height) * 0.4 // Size of the sphere

    // Generate points on a sphere (Fibonacci sphere algorithm)
    for (let i = 0; i < particleCount; i++) {
      const phi = Math.acos(1 - (2 * i) / particleCount)
      const theta = Math.PI * (1 + Math.sqrt(5)) * i

      const x = Math.cos(theta) * Math.sin(phi)
      const y = Math.sin(theta) * Math.sin(phi)
      const z = Math.cos(phi)

      particles.push({
        baseX: x,
        baseY: y,
        baseZ: z,
        currentX: x,
        currentY: y,
        currentZ: z,
        screenX: 0,
        screenY: 0,
        scale: 1,
        size: Math.random() * 2 + 1.5, // Size of the dot
      })
    }

    let angleX = 0
    let angleY = 0

    let mouse = { x: width / 2, y: height / 2, isActive: false }

    const handleMouseMove = (e: MouseEvent) => {
      mouse.x = e.clientX
      mouse.y = e.clientY
      mouse.isActive = true
    }

    const handleMouseLeave = () => {
      mouse.isActive = false
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseleave', handleMouseLeave)

    const handleResize = () => {
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = width
      canvas.height = height
    }
    window.addEventListener('resize', handleResize)

    let animationFrameId: number

    // Bucketed connection opacity — batches every connection into a handful
    // of Path2D objects so a frame does a few stroke() calls instead of up
    // to ~20k individual ones (each stroke() call has real per-call
    // overhead; that was the single biggest cost in this loop).
    const OPACITY_BUCKETS = 6
    const bucketPaths: Path2D[] = Array.from({ length: OPACITY_BUCKETS }, () => new Path2D())

    const render = () => {
      ctx.clearRect(0, 0, width, height)

      // Auto rotation
      angleX += 0.001
      angleY += 0.002

      const cx = width / 2
      const cy = height / 2
      const cosY = Math.cos(angleY), sinY = Math.sin(angleY)
      const cosX = Math.cos(angleX), sinX = Math.sin(angleX)

      // Project in place — no per-frame array/object allocation.
      for (const p of particles) {
        // Rotate around Y axis
        const x1 = p.baseX * cosY - p.baseZ * sinY
        const z1 = p.baseZ * cosY + p.baseX * sinY

        // Rotate around X axis
        const y2 = p.baseY * cosX - z1 * sinX
        const z2 = z1 * cosX + p.baseY * sinX

        p.currentX = x1
        p.currentY = y2
        p.currentZ = z2

        // Simple perspective projection
        const scale = 300 / (300 + z2 * sphereRadius)
        let screenX = cx + x1 * sphereRadius * scale
        let screenY = cy + y2 * sphereRadius * scale

        // Interactive mouse push effect
        if (mouse.isActive) {
          const dx = mouse.x - screenX
          const dy = mouse.y - screenY
          const dist = Math.sqrt(dx * dx + dy * dy)
          const maxDist = 150

          if (dist < maxDist) {
            const force = (maxDist - dist) / maxDist
            screenX -= dx * force * 0.5
            screenY -= dy * force * 0.5
          }
        }

        p.screenX = screenX
        p.screenY = screenY
        p.scale = scale
      }

      // Sort by Z index to render back to front
      particles.sort((a, b) => b.currentZ - a.currentZ)

      // Draw connections — accumulate into opacity buckets, one stroke() per bucket
      for (let b = 0; b < OPACITY_BUCKETS; b++) bucketPaths[b] = new Path2D()

      for (let i = 0; i < particles.length; i++) {
        const p1 = particles[i]
        // Only draw lines for particles somewhat in front to save performance and make it look clean
        if (p1.currentZ > 0.5) continue

        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j]
          if (p2.currentZ > 0.5) continue

          const dx = p1.screenX - p2.screenX
          const dy = p1.screenY - p2.screenY
          const distSq = dx * dx + dy * dy

          if (distSq < 3600) { // 60px threshold, squared — skips a sqrt for most pairs
            const dist = Math.sqrt(distSq)
            const opacity = (1 - dist / 60) * 0.3 * p1.scale
            const bucket = Math.min(OPACITY_BUCKETS - 1, Math.max(0, Math.floor((opacity / 0.3) * OPACITY_BUCKETS)))
            bucketPaths[bucket].moveTo(p1.screenX, p1.screenY)
            bucketPaths[bucket].lineTo(p2.screenX, p2.screenY)
          }
        }
      }

      ctx.lineWidth = 0.5
      for (let b = 0; b < OPACITY_BUCKETS; b++) {
        ctx.strokeStyle = `rgba(139, 13, 26, ${((b + 1) / OPACITY_BUCKETS) * 0.3})`
        ctx.stroke(bucketPaths[b])
      }

      // Draw particles (Dots) — a soft halo + solid core, no shadowBlur
      // (shadow rendering is one of Canvas2D's most expensive per-call ops).
      ctx.fillStyle = '#8B0D1A'
      for (const p of particles) {
        const size = p.size * p.scale
        const opacity = Math.max(0.1, (1 - (p.currentZ + 1) / 2)) // Fade out particles in back

        ctx.globalAlpha = opacity * 0.35
        ctx.beginPath()
        ctx.arc(p.screenX, p.screenY, size * 2.2, 0, Math.PI * 2)
        ctx.fill()

        ctx.globalAlpha = opacity
        ctx.beginPath()
        ctx.arc(p.screenX, p.screenY, size, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.globalAlpha = 1

      animationFrameId = requestAnimationFrame(render)
    }

    render()

    return () => {
      cancelAnimationFrame(animationFrameId)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-0 pointer-events-none mix-blend-screen"
    />
  )
}

interface Particle {
  baseX: number
  baseY: number
  baseZ: number
  currentX: number
  currentY: number
  currentZ: number
  screenX: number
  screenY: number
  scale: number
  size: number
}
