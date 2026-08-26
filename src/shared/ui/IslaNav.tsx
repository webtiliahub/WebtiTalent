'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Icono } from './iconos'
import type { NavMovil } from '../lib/navegacion'

/** Isla flotante híbrida (solo móvil): iconos solos; el destino ACTIVO se expande en una
 * pastilla roja con su nombre. En modo `directa` (colaborador simple) lleva los 4 accesos
 * de Lo mío; en modo `secciones` lleva las secciones (cada una abre su hub de cards).
 *
 * Gesto táctil (patrón de Instagram/Threads): lo que se arrastra es LA PASTILLA ROJA. Al apoyar
 * el dedo se desliza hasta el icono tocado y, en cuanto el dedo se mueve, la pastilla lo sigue
 * PÍXEL A PÍXEL (sin transición: saltar de icono a icono se sentía como brincos). Al soltar
 * encaja en el destino con rebote —como el pulgar de un slider— y recién ahí navega; si se suelta
 * fuera, encaja de vuelta en el destino que estaba abierto.
 *
 * Durante el arrastre el layout no se toca a propósito: la etiqueta del activo cambia el ancho de
 * su botón, y desplegarla/colapsarla en pleno gesto recolocaría los iconos bajo el dedo, con el
 * candidato oscilando entre dos. Por eso la etiqueta se queda donde está hasta que se confirma y
 * la pastilla toma el ancho del icono que tiene debajo.
 */
export function IslaNav({ nav }: { nav: NavMovil }) {
  const pathname = usePathname()
  const router = useRouter()

  // Destinos a pintar: [href al que navega, etiqueta de la pastilla, icono, hrefs que lo activan]
  const destinos = nav.tipo === 'directa'
    ? nav.items.map((i) => ({ href: i.href, etiqueta: i.corto ?? i.label, icono: i.icono, activadores: [i.href] }))
    : nav.secciones.map((s) => ({ href: s.href, etiqueta: s.label, icono: s.icono, activadores: [s.href, ...s.items.map((i) => i.href)] }))

  // Activo = el destino con el prefijo activador MÁS LARGO que matchea (regla del Shell)
  const mejor = destinos
    .flatMap((d) => d.activadores.map((a) => ({ d, a })))
    .filter(({ a }) => pathname === a || pathname.startsWith(a + '/'))
    .sort((x, y) => y.a.length - x.a.length)[0]?.d
  const idxActivo = mejor ? destinos.indexOf(mejor) : -1

  const islaRef = useRef<HTMLDivElement>(null)
  const itemsRef = useRef<(HTMLAnchorElement | null)[]>([])
  const pillActivoRef = useRef<HTMLSpanElement>(null)
  const gestoRef = useRef(false) // un tap ya navegó: el click posterior del Link no debe repetirlo
  // Candidato = icono bajo el dedo mientras se arrastra la pastilla (null = no hay gesto en curso)
  const [candidato, setCandidato] = useState<number | null>(null)
  const candidatoRef = useRef<number | null>(null)
  // Arrastre en curso: ancho que conserva la pastilla, si ya sigue al dedo, y dónde empezó
  const arrastreRef = useRef<{ ancho: number; siguiendo: boolean; xInicial: number } | null>(null)

  /** Coloca un resaltado sobre el ítem `i`. `animado=false` lo posiciona de golpe: al aparecer
   * hay que hacerlo así, o transiciona desde translateX(0)/width:0 y cruza la isla volando. */
  const colocar = useCallback((pill: HTMLSpanElement | null, i: number | null, visible: boolean, animado: boolean) => {
    const isla = islaRef.current
    if (!pill || !isla) return
    if (i === null || i < 0 || !itemsRef.current[i]) { pill.style.opacity = '0'; return }
    const r = itemsRef.current[i]!.getBoundingClientRect()
    const base = isla.getBoundingClientRect()
    // clientLeft = grosor del borde: el absoluto se ancla a la caja interna, no al borde
    const x = r.left - base.left - isla.clientLeft
    if (!animado) {
      pill.style.transition = 'none'
      pill.style.width = `${r.width}px`
      pill.style.transform = `translateX(${x}px)`
      void pill.offsetWidth // reflow: el salto se aplica antes de devolver la transición
      pill.style.transition = ''
    } else {
      pill.style.width = `${r.width}px`
      pill.style.transform = `translateX(${x}px)`
    }
    pill.style.opacity = visible ? '1' : '0'
  }, [])

  // El pill del activo: de golpe al montar, deslizándose cuando cambia la ruta. Se sigue con
  // rAF mientras la etiqueta se despliega, porque su ancho cambia durante la transición.
  const montado = useRef(false)
  useEffect(() => {
    const animado = montado.current
    montado.current = true
    let raf = 0
    // ~26 frames ≈ 430 ms a 60 fps: lo que dura la transición de la etiqueta al desplegarse.
    // Se sigue por frames y no por reloj para no leer el tiempo dentro del efecto.
    let frames = 26
    const seguir = () => {
      // Si el dedo está arrastrando, manda el gesto: el efecto no recoloca la pastilla
      if (arrastreRef.current === null) colocar(pillActivoRef.current, idxActivo, idxActivo >= 0, animado)
      if (frames-- > 0) raf = requestAnimationFrame(seguir)
    }
    seguir()
    const alRedimensionar = () => colocar(pillActivoRef.current, idxActivo, idxActivo >= 0, false)
    window.addEventListener('resize', alRedimensionar)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', alRedimensionar) }
  }, [idxActivo, colocar])

  /** Ítem bajo el punto, con margen generoso: el dedo tapa el icono y la puntería es gruesa. */
  const indiceEn = (x: number, y: number) => {
    const isla = islaRef.current
    if (!isla) return null
    const base = isla.getBoundingClientRect()
    if (x < base.left - 12 || x > base.right + 12 || y < base.top - 24 || y > base.bottom + 24) return null
    let mejorIdx: number | null = null
    let mejorDist = Infinity
    itemsRef.current.forEach((el, i) => {
      if (!el) return
      const r = el.getBoundingClientRect()
      const d = Math.abs(x - (r.left + r.width / 2))
      if (d < mejorDist) { mejorDist = d; mejorIdx = i }
    })
    return mejorIdx
  }

  /** Marca qué icono está bajo el dedo (color rojo + hundido). No mueve la pastilla: eso lo hace
   * el seguimiento continuo, para que no se sienta a saltos. */
  const marcarCandidato = (i: number | null) => {
    if (i === candidatoRef.current) return
    candidatoRef.current = i
    setCandidato(i)
  }

  /** La pastilla centrada en el dedo, sin transición y sin salirse de la isla. */
  const seguirDedo = (clientX: number, ancho: number) => {
    const isla = islaRef.current
    const pill = pillActivoRef.current
    if (!isla || !pill) return
    const base = isla.getBoundingClientRect()
    const max = isla.clientWidth - ancho
    const x = Math.max(0, Math.min(max, clientX - base.left - isla.clientLeft - ancho / 2))
    pill.style.width = `${ancho}px`
    pill.style.transform = `translateX(${x}px)`
    pill.style.opacity = '1'
  }

  /** Fin del gesto: devuelve la transición y encaja la pastilla en `i` (o en el activo). */
  const encajar = (i: number | null) => {
    const pill = pillActivoRef.current
    if (pill) pill.style.transition = ''
    arrastreRef.current = null
    marcarCandidato(null)
    colocar(pill, i ?? idxActivo, true, true)
  }

  const alBajar = (e: React.PointerEvent<HTMLDivElement>) => {
    const i = indiceEn(e.clientX, e.clientY)
    if (i === null || !itemsRef.current[i]) return
    islaRef.current?.setPointerCapture(e.pointerId)
    // La pastilla conserva el ancho del icono tocado durante todo el arrastre: si además
    // cambiara de ancho al pasar sobre cada icono, volvería el efecto de saltos
    arrastreRef.current = { ancho: itemsRef.current[i]!.getBoundingClientRect().width, siguiendo: false, xInicial: e.clientX }
    marcarCandidato(i)
    colocar(pillActivoRef.current, i, true, true) // viaja hasta el icono tocado
  }

  const alMover = (e: React.PointerEvent<HTMLDivElement>) => {
    const a = arrastreRef.current
    if (!a) return
    // Umbral de 4 px: un tap con micro-temblor no debe convertirse en arrastre
    if (!a.siguiendo && Math.abs(e.clientX - a.xInicial) > 4) {
      a.siguiendo = true
      if (pillActivoRef.current) pillActivoRef.current.style.transition = 'none'
    }
    if (a.siguiendo) seguirDedo(e.clientX, a.ancho)
    marcarCandidato(indiceEn(e.clientX, e.clientY))
  }

  const alSoltar = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!arrastreRef.current) return
    const i = indiceEn(e.clientX, e.clientY)
    encajar(i) // encaja donde soltaste, o de vuelta en el activo si fue fuera
    if (i === null) return // soltó fuera: sin navegar
    gestoRef.current = true
    if (destinos[i] && i !== idxActivo) router.push(destinos[i].href)
  }

  return (
    <nav aria-label="Navegación principal" className="fixed inset-x-4 z-40 md:hidden" style={{ bottom: 'max(12px, env(safe-area-inset-bottom))' }}>
      {/* w-fit: la isla abraza sus botones (con 2-3 secciones, el ancho completo dejaba
          huecos enormes entre iconos); max-w como tope para el modo directa con pastilla larga */}
      <div
        ref={islaRef}
        onPointerDown={alBajar}
        onPointerMove={alMover}
        onPointerUp={alSoltar}
        onPointerCancel={() => encajar(null)}
        // touch-none: arrastrar dentro de la isla no debe scrollear la página.
        // touch-callout: el dedo apoyado no debe abrir el menú de iOS.
        className="relative mx-auto flex w-fit max-w-full touch-none select-none items-center justify-center gap-1.5 rounded-full border border-gris-claro bg-white/95 px-3 py-2 shadow-[0_10px_30px_rgba(23,19,15,0.16)] backdrop-blur [-webkit-touch-callout:none]"
      >
        {/* La pastilla que se arrastra. Rebota al llegar: es el «kick» que da la sensación de
            que el fondo tiene peso. */}
        <span
          ref={pillActivoRef}
          aria-hidden
          className="pointer-events-none absolute inset-y-2 left-0 w-0 rounded-full bg-marca/10 opacity-0 transition-[transform,width,opacity] duration-[320ms] ease-[cubic-bezier(.22,1.18,.36,1)] motion-reduce:transition-none"
        />

        {destinos.map((d, i) => {
          const activo = i === idxActivo
          // Con el dedo encima manda el candidato: el icono se pinta de rojo aunque todavía no
          // se haya navegado, y el activo real se apaga mientras la pastilla no está sobre él
          const enRojo = candidato === null ? activo : candidato === i
          return (
            <Link
              key={d.href}
              ref={(el) => { itemsRef.current[i] = el }}
              href={d.href}
              aria-current={activo ? 'page' : undefined}
              aria-label={d.etiqueta}
              // El gesto ya navegó en pointerup: el click del mismo tap no debe repetirlo.
              // Enter con el foco puesto no marca la bandera, así que sigue navegando.
              onClick={(e) => { if (gestoRef.current) { e.preventDefault(); gestoRef.current = false } }}
              draggable={false}
              className={`relative z-[1] flex items-center rounded-full px-3.5 py-2 transition-[transform,color] duration-150 ${enRojo ? 'text-marca' : 'text-gris'} ${candidato === i ? 'scale-[0.93]' : ''}`}
            >
              <span className="grid w-5 place-items-center"><Icono slug={d.icono} /></span>
              {/* La etiqueta no se monta y desmonta: anima su ancho, y ese ensanchamiento con
                  rebote es el «kick» de la isla al confirmar el destino. El padding vive DENTRO
                  del contenedor recortado, así en los inactivos no deja hueco. */}
              <span className={`overflow-hidden whitespace-nowrap transition-[max-width] duration-[320ms] ease-[cubic-bezier(.22,1.18,.36,1)] motion-reduce:transition-none ${activo ? 'max-w-[120px]' : 'max-w-0'}`}>
                <span className="pl-1.5 text-[11.5px] font-extrabold">{d.etiqueta}</span>
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
