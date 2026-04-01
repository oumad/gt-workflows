import { useEffect, useRef } from 'react'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  alpha: number
}

function randomParticle(w: number, h: number): Particle {
  const speed = 0.15 + Math.random() * 0.55
  const angle = Math.random() * Math.PI * 2
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    r: Math.random() * 1.8 + 0.4,
    alpha: Math.random() * 0.28 + 0.08,
  }
}

export function LoginParticlesCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const parent = canvas.parentElement
    if (!parent) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const targetCount = reducedMotion ? 0 : 85

    let particles: Particle[] = []
    let width = 0
    let height = 0
    let rafId = 0

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio ?? 1, 2)
      width = parent.clientWidth
      height = parent.clientHeight
      if (width < 1 || height < 1) return
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      particles = []
      for (let i = 0; i < targetCount; i++) {
        particles.push(randomParticle(width, height))
      }
    }

    const tick = () => {
      ctx.clearRect(0, 0, width, height)
      for (const p of particles) {
        p.x += p.vx
        p.y += p.vy
        if (p.x < -2) p.x = width + 2
        else if (p.x > width + 2) p.x = -2
        if (p.y < -2) p.y = height + 2
        else if (p.y > height + 2) p.y = -2

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(167, 139, 250, ${p.alpha})`
        ctx.fill()
      }
      rafId = requestAnimationFrame(tick)
    }

    resize()

    const ro = new ResizeObserver(() => {
      resize()
    })
    ro.observe(parent)

    if (!reducedMotion && targetCount > 0) {
      rafId = requestAnimationFrame(tick)
    }

    return () => {
      ro.disconnect()
      cancelAnimationFrame(rafId)
    }
  }, [])

  return <canvas ref={canvasRef} className="login-particles-canvas" aria-hidden />
}
