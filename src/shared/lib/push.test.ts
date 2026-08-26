import { describe, it, expect } from 'vitest'
import { esSuscripcionCaducada, type AvisoPush } from './push'

describe('esSuscripcionCaducada', () => {
  it('404 y 410 → la suscripción murió y se borra', () => {
    expect(esSuscripcionCaducada(404)).toBe(true)
    expect(esSuscripcionCaducada(410)).toBe(true)
  })
  it('fallos transitorios → la suscripción se conserva', () => {
    // 429 (rate limit) y 5xx son del servicio, no del dispositivo: borrarla dejaría al usuario
    // sin notificaciones para siempre por un problema de una tarde
    for (const codigo of [400, 401, 403, 413, 429, 500, 502, 503]) {
      expect(esSuscripcionCaducada(codigo)).toBe(false)
    }
  })
  it('sin código (error de red) → se conserva', () => {
    expect(esSuscripcionCaducada(undefined)).toBe(false)
  })
})

describe('payload del aviso', () => {
  it('viaja como JSON con las cuatro claves que lee el service worker', () => {
    const aviso: AvisoPush = { titulo: 'Tienes evaluaciones por responder', cuerpo: 'Ciclo 2026-I · hasta el 30 de junio', ruta: '/evaluaciones', etiqueta: 'evaluaciones' }
    expect(JSON.parse(JSON.stringify(aviso))).toEqual(aviso)
  })
  it('la ruta es interna: el service worker la resuelve contra el origen', () => {
    const rutas = ['/evaluaciones', '/objetivos', '/mi-resultado', '/equipo/objetivos', '/admin/ciclos']
    for (const r of rutas) expect(r.startsWith('/')).toBe(true)
  })
})
