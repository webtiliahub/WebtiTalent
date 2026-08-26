import { createElement, type ReactElement } from 'react'
import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { prisma } from '@/shared/lib/prisma'
import { getSesion } from '@/shared/lib/auth'
import { fueraDeAlcancePais } from '@/shared/lib/permisos'
import { datosInformePdf } from '@/features/resultados/informe-pdf/datos'
import { InformePdf } from '@/features/resultados/informe-pdf/InformePdf'

/** Descarga del informe PDF de resultados: GET /api/resultado-pdf?colaborador=&ciclo=
 * Mismo guard que la consulta web del resultado: el propio colaborador, su jefe directo,
 * o RR.HH. dentro de su alcance de país. Solo resultados PUBLICADOS (lo valida datos.ts). */
export async function GET(req: NextRequest) {
  const sesion = await getSesion()
  if (!sesion) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const colaboradorId = req.nextUrl.searchParams.get('colaborador')
  const cicloId = req.nextUrl.searchParams.get('ciclo') ?? undefined
  if (!colaboradorId) return NextResponse.json({ error: 'Falta el colaborador' }, { status: 400 })

  const colaborador = await prisma.colaborador.findUnique({
    where: { id: colaboradorId },
    select: { jefeId: true, paisId: true },
  })
  if (!colaborador) return NextResponse.json({ error: 'Colaborador no encontrado' }, { status: 404 })

  const puedeVer =
    sesion.colaboradorId === colaboradorId ||
    colaborador.jefeId === sesion.colaboradorId ||
    (sesion.rol === 'RRHH' && !fueraDeAlcancePais(sesion, colaborador.paisId))
  if (!puedeVer) return NextResponse.json({ error: 'Sin permiso' }, { status: 403 })

  const datos = await datosInformePdf(colaboradorId, cicloId)
  if (!datos) return NextResponse.json({ error: 'Sin resultado publicado para ese ciclo' }, { status: 404 })

  const buffer = await renderToBuffer(createElement(InformePdf, { datos }) as ReactElement<DocumentProps>)
  // Nombre de archivo ASCII (el header no admite tildes sin encoding RFC 5987)
  const nombreArchivo = `Resultados - ${datos.colaborador.nombre} - ${datos.ciclo.nombre}.pdf`
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w .()-]/g, '')

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${nombreArchivo}"`,
      'Cache-Control': 'no-store',
    },
  })
}
