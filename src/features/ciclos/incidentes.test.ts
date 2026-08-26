import { describe, it, expect } from 'vitest'
import { agruparIncidentes, type AsigIncidente } from './incidentes'

const base = (extra: Partial<AsigIncidente>): AsigIncidente => ({
  id: 'a1', tipo: 'JEFE', estado: 'PENDIENTE',
  evaluado: { id: 'c1', nombres: 'Marita', apellidos: 'Cedeño', puesto: 'Analista', pais: 'Chile' },
  evaluador: { id: 'e1', nombres: 'Renzo', apellidos: 'Aguirre', activo: false },
  ...extra,
})

describe('agruparIncidentes', () => {
  it('agrupa por evaluado impactado los insumos de evaluadores dados de baja', () => {
    const out = agruparIncidentes([
      base({ id: 'a1', tipo: 'JEFE' }),
      base({ id: 'a2', tipo: 'PAR', evaluador: { id: 'e2', nombres: 'Laura', apellidos: 'Restrepo', activo: false } }),
      base({ id: 'a3', evaluado: { id: 'c2', nombres: 'Jazmin', apellidos: 'Zarzar', puesto: 'Analista', pais: 'Chile' } }),
    ])
    expect(out).toHaveLength(2)
    const marita = out.find((x) => x.colaboradorId === 'c1')!
    expect(marita.insumos.map((i) => i.tipo)).toEqual(['JEFE', 'PAR'])
  })

  it('ignora asignaciones de evaluadores activos y las ya enviadas', () => {
    const out = agruparIncidentes([
      base({ id: 'a1', evaluador: { id: 'e1', nombres: 'R', apellidos: 'A', activo: true } }),
      base({ id: 'a2', estado: 'ENVIADA' }),
      base({ id: 'a3', estado: 'INVALIDADA' }),
    ])
    expect(out).toHaveLength(0)
  })

  it('a un incidente de PAR le adjunta la evaluación ENVIADA del otro par (candidata a invalidar)', () => {
    const out = agruparIncidentes([
      base({ id: 'a1', tipo: 'PAR' }),
      base({ id: 'a2', tipo: 'PAR', estado: 'ENVIADA', evaluador: { id: 'e9', nombres: 'Sofía', apellidos: 'Duarte', activo: true } }),
    ])
    expect(out[0].insumos[0].hermanaEnviada).toEqual({ asignacionId: 'a2', evaluador: 'Sofía Duarte' })
  })

  it('el incidente de JEFE no lleva hermana', () => {
    const out = agruparIncidentes([base({ id: 'a1', tipo: 'JEFE' })])
    expect(out[0].insumos[0].hermanaEnviada).toBeNull()
  })
})
