/**
 * Chime de login exitoso, versión Hunter: confirmación firme y segura (dos notas
 * graves ascendentes G3→C4 con un sub grave que "aterriza"), corta (~1s) y cálida
 * (onda triangular). Menos etérea que un acorde en swell: suena a "acceso concedido /
 * cerradura que abre", acorde a una empresa de seguridad.
 * Generado con Web Audio API — sin assets ni dependencias.
 *
 * Robusto por diseño: cualquier fallo (navegador sin AudioContext, política de
 * autoplay, etc.) se traga en silencio. El audio NUNCA debe romper el login.
 */
export function playLoginChime() {
  if (typeof window === 'undefined') return
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    // El click del submit es un gesto de usuario; resume() asegura el desbloqueo.
    void ctx.resume?.()

    const master = ctx.createGain()
    master.gain.value = 0.55
    master.connect(ctx.destination)

    const now = ctx.currentTime
    // tipo de onda, freq, retraso, pico, attack (corto = decidido), duración.
    const capas: Array<[OscillatorType, number, number, number, number, number]> = [
      ['triangle', 196.0, 0, 0.22, 0.012, 0.5], // G3 — arranque firme
      ['sine', 98.0, 0, 0.10, 0.02, 0.5], // G2 — cuerpo del arranque
      ['triangle', 261.63, 0.13, 0.26, 0.012, 0.95], // C4 — resolución "acceso concedido"
      ['sine', 130.81, 0.13, 0.14, 0.02, 0.95], // C3 — aterrizaje grave que asienta
      ['sine', 523.25, 0.16, 0.05, 0.05, 0.6], // C5 — brillo mínimo, apenas perceptible
    ]
    for (const [tipo, freq, delay, peak, attack, dur] of capas) {
      const t = now + delay
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = tipo
      osc.frequency.value = freq
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(peak, t + attack) // entrada decidida
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur) // decaimiento natural
      osc.connect(g)
      g.connect(master)
      osc.start(t)
      osc.stop(t + dur + 0.05)
    }

    // Libera el contexto cuando termina (evita acumular AudioContexts).
    window.setTimeout(() => { void ctx.close?.() }, 1500)
  } catch {
    /* no-op: el sonido es un extra, nunca debe interrumpir el login */
  }
}
