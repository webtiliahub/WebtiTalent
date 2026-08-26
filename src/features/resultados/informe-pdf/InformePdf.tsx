/** Informe PDF de resultados de evaluación (A4). Réplica del layout aprobado:
 * pág. 1 = encabezado + colaborador/ciclo + KPIs + desglose del cálculo;
 * pág. 2 = radar por dimensión + sesión de feedback y PDI.
 * Se renderiza en el servidor con @react-pdf/renderer (route handler). */
import { Document, Page, View, Text, Image, StyleSheet, Svg, Polygon, Line, Circle, Text as SvgText, Tspan } from '@react-pdf/renderer'
import { ISOTIPO_HUNTER } from './isotipo'
import type { DatosInforme } from './datos'

const C = {
  hunter: '#f0163e',
  negro: '#2a2623',
  gris: '#8a857f',
  grisClaro: '#e5e1dc',
  hueso: '#f7f5f2',
  hueso2: '#efece8',
  verde: '#059669',
  ambar: '#b45309',
}

const s = StyleSheet.create({
  pagina: { paddingTop: 36, paddingBottom: 48, paddingHorizontal: 42, fontFamily: 'Helvetica', fontSize: 9.5, color: C.negro },
  // Encabezado
  cabecera: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 2.5, borderBottomColor: C.hunter, paddingBottom: 10, marginBottom: 14 },
  marca: { fontFamily: 'Helvetica-Bold', fontSize: 15 },
  sub: { fontSize: 8, color: C.gris, marginTop: 2 },
  tituloInforme: { fontFamily: 'Helvetica-Bold', fontSize: 14, textAlign: 'right' },
  // Bloques de info
  bloques: { flexDirection: 'row', gap: 12 },
  bloque: { flex: 1, backgroundColor: C.hueso, borderRadius: 8, padding: 12 },
  bloqueTitulo: { fontFamily: 'Helvetica-Bold', fontSize: 7.5, color: C.gris, letterSpacing: 0.8, marginBottom: 7 },
  fila: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4, gap: 10 },
  filaLabel: { color: C.gris, fontSize: 8.5 },
  filaValor: { fontFamily: 'Helvetica-Bold', fontSize: 8.5, textAlign: 'right', flexShrink: 1 },
  // KPIs
  kpis: { flexDirection: 'row', gap: 12, marginTop: 12 },
  kpi: { flex: 1, borderWidth: 1, borderColor: C.grisClaro, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 10, alignItems: 'center' },
  kpiLabel: { fontFamily: 'Helvetica-Bold', fontSize: 7.5, color: C.gris, letterSpacing: 0.8, marginBottom: 5 },
  kpiValor: { fontFamily: 'Helvetica-Bold', fontSize: 22, color: C.hunter },
  kpiNota: { fontSize: 7.5, color: C.gris, textAlign: 'center', marginTop: 5 },
  pill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2.5, fontFamily: 'Helvetica-Bold', fontSize: 7.5, color: '#ffffff', marginTop: 5 },
  // Secciones
  seccion: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16, marginBottom: 8 },
  seccionBarra: { width: 3.5, height: 12, backgroundColor: C.hunter, borderRadius: 2 },
  seccionTitulo: { fontFamily: 'Helvetica-Bold', fontSize: 11.5 },
  // Tablas del cálculo
  columnas: { flexDirection: 'row', gap: 18 },
  col: { flex: 1 },
  thFila: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.grisClaro, paddingBottom: 3, marginBottom: 1 },
  th: { fontFamily: 'Helvetica-Bold', fontSize: 7, color: C.gris, letterSpacing: 0.5 },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: C.hueso2, paddingVertical: 4, alignItems: 'flex-start' },
  celda: { fontSize: 8.5 },
  compFila: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: C.hueso2, paddingVertical: 2.5, paddingLeft: 10 },
  compTexto: { fontSize: 8, color: C.gris },
  totalFila: { flexDirection: 'row', paddingVertical: 5, alignItems: 'center' },
  totalLabel: { fontFamily: 'Helvetica-Bold', fontSize: 9 },
  totalValor: { fontFamily: 'Helvetica-Bold', fontSize: 11, color: C.hunter },
  formula: { backgroundColor: C.hueso2, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, marginTop: 12, textAlign: 'center', fontSize: 9 },
  // Feedback / PDI
  feedbackCaja: { borderWidth: 1, borderColor: C.grisClaro, borderRadius: 8, padding: 12 },
  pdiItem: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: C.hueso, borderRadius: 6, paddingVertical: 5, paddingHorizontal: 8, marginTop: 4 },
  pie: { position: 'absolute', bottom: 22, left: 42, right: 42, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 0.5, borderTopColor: C.grisClaro, paddingTop: 6 },
  pieTexto: { fontSize: 7, color: C.gris },
})

function colorEtiqueta(nota: number): string {
  if (nota >= 3.5) return C.verde // Excepcional / Superior
  if (nota >= 2.5) return '#2563eb' // Competente
  if (nota >= 1.5) return C.ambar // En desarrollo
  return C.hunter // Insuficiente
}

const n2 = (v: number) => v.toFixed(2)

function Cabecera({ datos, mini }: { datos: DatosInforme; mini?: boolean }) {
  return (
    <View style={s.cabecera}>
      <Image src={ISOTIPO_HUNTER} style={{ width: mini ? 13 : 18, height: mini ? 19 : 26, marginRight: 8 }} />
      <View>
        <Text style={[s.marca, mini ? { fontSize: 11 } : {}]}>CENIT</Text>
        {!mini && <Text style={s.sub}>Evaluación de Desempeño 360</Text>}
      </View>
      <View style={{ marginLeft: 'auto' }}>
        {mini ? (
          <Text style={[s.sub, { textAlign: 'right' }]}>Informe de resultados · {datos.colaborador.nombre}</Text>
        ) : (
          <>
            <Text style={s.tituloInforme}>Informe de resultados</Text>
            <Text style={[s.sub, { textAlign: 'right' }]}>Documento confidencial · generado el {datos.generadoEl}</Text>
          </>
        )}
      </View>
    </View>
  )
}

function Seccion({ titulo }: { titulo: string }) {
  return (
    <View style={s.seccion}>
      <View style={s.seccionBarra} />
      <Text style={s.seccionTitulo}>{titulo}</Text>
    </View>
  )
}

function Pie({ datos }: { datos: DatosInforme }) {
  return (
    <View style={s.pie} fixed>
      <Text style={s.pieTexto}>CENIT · Talent Hub — Informe confidencial · {datos.colaborador.nombre} · {datos.ciclo.nombre}</Text>
      <Text style={s.pieTexto} render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
    </View>
  )
}

/** Mismo criterio de la web: partir nombres largos de dimensión en hasta 2 líneas. */
function envolver(nombre: string): string[] {
  if (nombre.length <= 15) return [nombre]
  const palabras = nombre.split(' ')
  const lineas: string[] = ['']
  for (const p of palabras) {
    if ((lineas[lineas.length - 1] + ' ' + p).trim().length > 15) lineas.push(p)
    else lineas[lineas.length - 1] = (lineas[lineas.length - 1] + ' ' + p).trim()
  }
  return lineas.slice(0, 2)
}

/** Radar por dimensión en SVG nativo de react-pdf (obtenido vs perfil esperado del puesto). */
function Radar({ dims }: { dims: DatosInforme['radar'] }) {
  const n = dims.length
  const W = 511, H = 300, cx = W / 2, cy = 150, R = 100
  const punto = (i: number, r: number): [number, number] => {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / n
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)]
  }
  const poligono = (r: (i: number) => number) => dims.map((_, i) => punto(i, r(i)).join(',')).join(' ')
  const radioDe = (v: number | null | undefined) => (R * Math.max(v ?? 0, 0)) / 5

  return (
    <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {[1, 2, 3, 4, 5].map((v) => (
        <Polygon key={v} points={poligono(() => (R * v) / 5)} fill="none" stroke={C.grisClaro} strokeWidth={v === 5 ? 1.1 : 0.6} />
      ))}
      {dims.map((_, i) => {
        const [x, y] = punto(i, R)
        return <Line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={C.grisClaro} strokeWidth={0.6} />
      })}
      <Polygon points={poligono((i) => radioDe(dims[i].esperado))} fill="#8a857f" fillOpacity={0.14} stroke="#8a857f" strokeWidth={1.3} strokeDasharray="3 2" />
      <Polygon points={poligono((i) => radioDe(dims[i].valor))} fill={C.hunter} fillOpacity={0.15} stroke={C.hunter} strokeWidth={1.5} />
      {dims.map((d, i) => {
        if (d.valor === null) return null
        const [x, y] = punto(i, radioDe(d.valor))
        return <Circle key={i} cx={x} cy={y} r={2.6} fill={C.hunter} stroke="#ffffff" strokeWidth={1} />
      })}
      {dims.map((d, i) => {
        const [x, y] = punto(i, R + 16)
        const cos = Math.cos(-Math.PI / 2 + (2 * Math.PI * i) / n)
        const anchor = Math.abs(cos) < 0.35 ? 'middle' : cos > 0 ? 'start' : 'end'
        const lineas = envolver(d.nombre)
        const colorValor = d.valor === null ? C.gris : d.valor >= d.esperado - 0.005 ? C.verde : C.hunter
        return lineas.map((linea, j) => {
          const ultima = j === lineas.length - 1
          return (
            <SvgText key={`${i}-${j}`} x={x} y={y - (lineas.length - 1 - j) * 11} style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', textAnchor: anchor, fill: '#5b564f' }}>
              <Tspan>{linea}</Tspan>
              {ultima && d.valor !== null && <Tspan fill={colorValor}>{'  ' + d.valor.toFixed(1)}</Tspan>}
            </SvgText>
          )
        })
      })}
    </Svg>
  )
}

export function InformePdf({ datos }: { datos: DatosInforme }) {
  const { colaborador, ciclo, notas, dimensiones, objetivos, radar, feedback } = datos
  const sinObjetivos = ciclo.periodo === null
  return (
    <Document title={`Informe de resultados · ${colaborador.nombre} · ${ciclo.nombre}`} author="CENIT · Talent Hub">
      {/* ── Página 1: identificación, KPIs y desglose del cálculo ── */}
      <Page size="A4" style={s.pagina}>
        <Cabecera datos={datos} />

        <View style={s.bloques}>
          <View style={s.bloque}>
            <Text style={s.bloqueTitulo}>COLABORADOR</Text>
            <View style={s.fila}><Text style={s.filaLabel}>Nombre</Text><Text style={s.filaValor}>{colaborador.nombre}</Text></View>
            <View style={s.fila}><Text style={s.filaLabel}>Puesto</Text><Text style={s.filaValor}>{colaborador.puesto}</Text></View>
            <View style={s.fila}><Text style={s.filaLabel}>Área / País</Text><Text style={s.filaValor}>{colaborador.areaPais}</Text></View>
            <View style={s.fila}><Text style={s.filaLabel}>Documento</Text><Text style={s.filaValor}>{colaborador.documento}</Text></View>
            <View style={[s.fila, { marginBottom: 0 }]}><Text style={s.filaLabel}>Jefe directo</Text><Text style={s.filaValor}>{colaborador.jefe}</Text></View>
          </View>
          <View style={s.bloque}>
            <Text style={s.bloqueTitulo}>CICLO DE EVALUACIÓN</Text>
            <View style={s.fila}><Text style={s.filaLabel}>Ciclo</Text><Text style={s.filaValor}>{ciclo.nombre}</Text></View>
            <View style={s.fila}><Text style={s.filaLabel}>Ventana del ciclo</Text><Text style={s.filaValor}>{ciclo.ventana}</Text></View>
            <View style={s.fila}><Text style={s.filaLabel}>Período de objetivos</Text><Text style={s.filaValor}>{ciclo.periodo ?? 'Sin objetivos en este ciclo'}</Text></View>
            <View style={[s.fila, { marginBottom: 0 }]}>
              <Text style={s.filaLabel}>Combinación del nivel</Text>
              <Text style={s.filaValor}>{sinObjetivos ? '100% competencias' : `Competencias ${ciclo.combinacion.comp}% · Objetivos ${ciclo.combinacion.obj}%`}</Text>
            </View>
          </View>
        </View>

        <View style={s.kpis}>
          <View style={[s.kpi, notas.final !== null && notas.final >= 4 ? { backgroundColor: '#e9f6f0', borderColor: '#bfe3d2' } : {}]}>
            <Text style={s.kpiLabel}>NOTA FINAL</Text>
            <Text style={s.kpiValor}>{notas.final !== null ? notas.final.toFixed(1) : '—'}</Text>
            {notas.etiqueta && notas.final !== null && (
              <Text style={[s.pill, { backgroundColor: colorEtiqueta(notas.final) }]}>{notas.etiqueta}</Text>
            )}
            {notas.calibrada !== null && <Text style={s.kpiNota}>Ajustada por calibración</Text>}
          </View>
          <View style={s.kpi}>
            <Text style={s.kpiLabel}>COMPETENCIAS</Text>
            <Text style={s.kpiValor}>{notas.competencias !== null ? notas.competencias.toFixed(1) : '—'}</Text>
            <Text style={s.kpiNota}>Evaluación 360 ponderada por dimensión</Text>
          </View>
          <View style={s.kpi}>
            <Text style={s.kpiLabel}>OBJETIVOS</Text>
            {sinObjetivos ? (
              <Text style={[s.kpiNota, { marginTop: 7 }]}>Sin objetivos en este ciclo</Text>
            ) : (
              <>
                <Text style={s.kpiValor}>{notas.objetivosPct !== null ? `${notas.objetivosPct}%` : '—'}</Text>
                <Text style={s.kpiNota}>Cumplimiento ponderado del ciclo</Text>
              </>
            )}
          </View>
        </View>

        <Seccion titulo="Cómo se calcula la nota final" />
        <View style={s.columnas}>
          <View style={s.col}>
            <View style={s.thFila}>
              <Text style={[s.th, { flex: 1 }]}>DIMENSIÓN / COMPETENCIA · {sinObjetivos ? 100 : ciclo.combinacion.comp}% DE LA NOTA</Text>
              <Text style={[s.th, { width: 32, textAlign: 'right' }]}>PESO</Text>
              <Text style={[s.th, { width: 34, textAlign: 'right' }]}>NOTA</Text>
            </View>
            {dimensiones.length === 0 && <Text style={[s.compTexto, { paddingVertical: 4 }]}>Sin respuestas de competencias en este ciclo.</Text>}
            {dimensiones.map((d) => (
              <View key={d.nombre}>
                <View style={s.tr}>
                  <Text style={[s.celda, { flex: 1, fontFamily: 'Helvetica-Bold' }]}>{d.nombre}</Text>
                  <Text style={[s.celda, { width: 32, textAlign: 'right', color: C.gris }]}>{d.pesoPct}%</Text>
                  <Text style={[s.celda, { width: 34, textAlign: 'right', fontFamily: 'Helvetica-Bold' }]}>{n2(d.nota)}</Text>
                </View>
                {d.competencias.map((cp) => (
                  <View key={cp.nombre} style={s.compFila}>
                    <Text style={[s.compTexto, { flex: 1 }]}>· {cp.nombre}</Text>
                    <Text style={[s.compTexto, { width: 34, textAlign: 'right' }]}>{n2(cp.nota)}</Text>
                  </View>
                ))}
              </View>
            ))}
            {notas.competencias !== null && (
              <View style={s.totalFila}>
                <Text style={[s.totalLabel, { flex: 1 }]}>Nota de competencias</Text>
                <Text style={s.totalValor}>{n2(notas.competencias)}</Text>
              </View>
            )}
          </View>

          {/* Ciclo sin período: sin objetivos que evaluar — se omite la columna completa (la
              competencias ocupa el ancho entero al ser la única hija de la fila flex) */}
          {!sinObjetivos && (
            <View style={s.col}>
              <View style={s.thFila}>
                <Text style={[s.th, { flex: 1 }]}>OBJETIVO · {ciclo.combinacion.obj}% DE LA NOTA</Text>
                <Text style={[s.th, { width: 32, textAlign: 'right' }]}>PESO</Text>
                <Text style={[s.th, { width: 40, textAlign: 'right' }]}>LOGRO</Text>
              </View>
              {objetivos.length === 0 && <Text style={[s.compTexto, { paddingVertical: 4 }]}>Sin objetivos configurados en este período.</Text>}
              {objetivos.map((o, i) => (
                <View key={i} style={s.tr}>
                  <View style={{ flex: 1, paddingRight: 6 }}>
                    <Text style={[s.celda, { fontFamily: 'Helvetica-Bold' }]}>{o.titulo}</Text>
                    <Text style={[s.compTexto, { marginTop: 1 }]}>{o.tipo}</Text>
                  </View>
                  <Text style={[s.celda, { width: 32, textAlign: 'right', color: C.gris }]}>{o.peso}%</Text>
                  <Text style={[s.celda, { width: 40, textAlign: 'right', fontFamily: 'Helvetica-Bold' }]}>{o.logro !== null ? `${o.logro}%` : '—'}</Text>
                </View>
              ))}
              {notas.objetivosPct !== null && (
                <View style={s.totalFila}>
                  <Text style={[s.totalLabel, { flex: 1 }]}>Cumplimiento ponderado</Text>
                  <Text style={s.totalValor}>
                    {notas.objetivosPct}%{notas.notaObjetivos !== null ? `  (${n2(notas.notaObjetivos)}/5)` : ''}
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>

        {sinObjetivos && notas.final !== null && notas.competencias !== null && (
          <Text style={s.formula}>
            {n2(notas.competencias)} × 100% (competencias) = {' '}
            <Text style={{ fontFamily: 'Helvetica-Bold', color: C.hunter }}>{n2(notas.calibrada ?? notas.final)}</Text>
            {notas.calibrada !== null ? '  · ajustada por calibración' : ''}
          </Text>
        )}
        {!sinObjetivos && notas.final !== null && notas.competencias !== null && notas.notaObjetivos !== null && (
          <Text style={s.formula}>
            {n2(notas.competencias)} × {ciclo.combinacion.comp}% (competencias) + {n2(notas.notaObjetivos)} × {ciclo.combinacion.obj}% (objetivos) = {' '}
            <Text style={{ fontFamily: 'Helvetica-Bold', color: C.hunter }}>{n2(notas.calibrada ?? notas.final)}</Text>
            {notas.calibrada !== null ? '  · ajustada por calibración' : ''}
          </Text>
        )}

        <Pie datos={datos} />
      </Page>

      {/* ── Página 2: radar por dimensión + feedback y PDI ── */}
      <Page size="A4" style={s.pagina}>
        <Cabecera datos={datos} mini />

        {radar.length >= 3 && (
          <>
            <Seccion titulo="Resultado por dimensión" />
            <Radar dims={radar} />
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Svg width={20} height={6}><Line x1={0} y1={3} x2={20} y2={3} stroke="#8a857f" strokeWidth={1.4} strokeDasharray="3 2" /></Svg>
                <Text style={{ fontSize: 8, color: C.gris }}>Perfil esperado del puesto</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View style={{ width: 20, height: 6, backgroundColor: '#fcd9e0', borderWidth: 1, borderColor: C.hunter }} />
                <Text style={{ fontSize: 8, color: C.gris }}>Obtenido · {ciclo.nombre}</Text>
              </View>
            </View>
          </>
        )}

        <Seccion titulo="Sesión de feedback y plan de desarrollo" />
        {!feedback ? (
          <Text style={[s.compTexto, { paddingVertical: 2 }]}>El jefe aún no registra la sesión de feedback de este ciclo.</Text>
        ) : (
          <View style={s.feedbackCaja}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
              <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 9 }}>Acuerdos</Text>
              <Text style={{ fontSize: 8, color: C.verde, fontFamily: 'Helvetica-Bold' }}>Registrada · {feedback.fecha}</Text>
            </View>
            <Text style={{ fontSize: 9, lineHeight: 1.45 }}>{feedback.acuerdos ?? 'Sin acuerdos registrados.'}</Text>
            {feedback.pdi.length > 0 && (
              <View style={{ marginTop: 8, borderTopWidth: 0.5, borderTopColor: C.grisClaro, paddingTop: 7 }}>
                <Text style={[s.bloqueTitulo, { marginBottom: 3 }]}>PLAN DE DESARROLLO INDIVIDUAL</Text>
                {feedback.pdi.map((a, i) => (
                  <View key={i} style={s.pdiItem}>
                    <Text style={{ fontSize: 8.5 }}>{a.titulo}</Text>
                    {a.fechaObjetivo && <Text style={{ fontSize: 8, color: C.gris }}>{a.fechaObjetivo}</Text>}
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        <Pie datos={datos} />
      </Page>
    </Document>
  )
}
