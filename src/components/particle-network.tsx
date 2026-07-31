'use client'

import React, { useEffect, useRef } from 'react'

const SPIDER_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <!-- Cuerpo central -->
  <path d="M50,25 C56,25 62,35 62,45 C62,60 55,75 50,80 C45,75 38,60 38,45 C38,35 44,25 50,25 Z" fill="#8B0D1A"/>
  <!-- Cabeza -->
  <circle cx="50" cy="20" r="6" fill="#8B0D1A"/>
  
  <!-- Patas derechas -->
  <path d="M60,30 Q80,10 90,30 Q95,40 90,55" stroke="#8B0D1A" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M62,40 Q85,35 95,50 Q98,60 90,75" stroke="#8B0D1A" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M60,50 Q80,60 85,80 Q88,90 80,95" stroke="#8B0D1A" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M55,60 Q70,75 70,95" stroke="#8B0D1A" stroke-width="4" fill="none" stroke-linecap="round"/>

  <!-- Patas izquierdas -->
  <path d="M40,30 Q20,10 10,30 Q5,40 10,55" stroke="#8B0D1A" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M38,40 Q15,35 5,50 Q2,60 10,75" stroke="#8B0D1A" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M40,50 Q20,60 15,80 Q12,90 20,95" stroke="#8B0D1A" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M45,60 Q30,75 30,95" stroke="#8B0D1A" stroke-width="4" fill="none" stroke-linecap="round"/>
</svg>
`

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

    // Pre-render the spider SVG to an offscreen image for performance
    const spiderImg = new Image()
    const svgBlob = new Blob([SPIDER_SVG], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)
    spiderImg.src = url

    let width = window.innerWidth
    let height = window.innerHeight
    canvas.width = width
    canvas.height = height

    const particles: Particle[] = []
    const particleCount = 450 // Lots of particles for the "thousands of connections" feel
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
        size: Math.random() * 8 + 4, // Size of the spider
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

    const render = () => {
      ctx.clearRect(0, 0, width, height)

      // Auto rotation
      angleX += 0.001
      angleY += 0.002

      const cx = width / 2
      const cy = height / 2

      // Calculate projected 2D coordinates
      const projectedParticles = particles.map((p) => {
        // Rotate around Y axis
        const x1 = p.baseX * Math.cos(angleY) - p.baseZ * Math.sin(angleY)
        const z1 = p.baseZ * Math.cos(angleY) + p.baseX * Math.sin(angleY)

        // Rotate around X axis
        const y2 = p.baseY * Math.cos(angleX) - z1 * Math.sin(angleX)
        const z2 = z1 * Math.cos(angleX) + p.baseY * Math.sin(angleX)

        p.currentX = x1
        p.currentY = y2
        p.currentZ = z2

        // Simple perspective projection
        const scale = 300 / (300 + z2 * sphereRadius)
        const screenX = cx + x1 * sphereRadius * scale
        const screenY = cy + y2 * sphereRadius * scale

        // Interactive mouse push effect
        let finalX = screenX
        let finalY = screenY
        
        if (mouse.isActive) {
          const dx = mouse.x - screenX
          const dy = mouse.y - screenY
          const dist = Math.sqrt(dx * dx + dy * dy)
          const maxDist = 150
          
          if (dist < maxDist) {
            const force = (maxDist - dist) / maxDist
            finalX -= dx * force * 0.5
            finalY -= dy * force * 0.5
          }
        }

        return {
          ...p,
          screenX: finalX,
          screenY: finalY,
          scale,
        }
      })

      // Sort by Z index to render back to front
      projectedParticles.sort((a, b) => b.currentZ - a.currentZ)

      // Draw connections
      ctx.lineWidth = 0.5
      for (let i = 0; i < projectedParticles.length; i++) {
        const p1 = projectedParticles[i]
        // Only draw lines for particles somewhat in front to save performance and make it look clean
        if (p1.currentZ > 0.5) continue

        for (let j = i + 1; j < projectedParticles.length; j++) {
          const p2 = projectedParticles[j]
          if (p2.currentZ > 0.5) continue

          const dx = p1.screenX - p2.screenX
          const dy = p1.screenY - p2.screenY
          const dist = Math.sqrt(dx * dx + dy * dy)

          if (dist < 60) {
            const opacity = (1 - dist / 60) * 0.3 * p1.scale
            ctx.beginPath()
            ctx.strokeStyle = `rgba(139, 13, 26, ${opacity})`
            ctx.moveTo(p1.screenX, p1.screenY)
            ctx.lineTo(p2.screenX, p2.screenY)
            ctx.stroke()
          }
        }
      }

      // Draw particles (Spiders)
      if (spiderImg.complete && spiderImg.naturalWidth !== 0) {
        for (const p of projectedParticles) {
          const size = p.size * p.scale
          const opacity = Math.max(0.1, (1 - (p.currentZ + 1) / 2)) // Fade out particles in back
          
          ctx.globalAlpha = opacity
          // Adding a subtle red glow
          ctx.shadowBlur = 10
          ctx.shadowColor = 'rgba(139, 13, 26, 0.8)'
          
          ctx.drawImage(
            spiderImg,
            p.screenX - size / 2,
            p.screenY - size / 2,
            size,
            size
          )
        }
      }
      ctx.globalAlpha = 1
      ctx.shadowBlur = 0

      animationFrameId = requestAnimationFrame(render)
    }

    spiderImg.onload = () => {
      render()
    }

    return () => {
      cancelAnimationFrame(animationFrameId)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseleave', handleMouseLeave)
      URL.revokeObjectURL(url)
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
  size: number
}
