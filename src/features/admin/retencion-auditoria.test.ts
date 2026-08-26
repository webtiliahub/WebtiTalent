import { describe, it, expect } from 'vitest'
import { nivelDeRetencion } from './retencion-auditoria'

/* La política se prueba acción por acción: borrar de más aquí destruye la trazabilidad que
   sostiene una nota impugnada, y es un daño que no se puede deshacer. */

describe('nivelDeRetencion', () => {
  it('nunca caduca lo que toca una evaluación o su resultado', () => {
    for (const accion of [
      'CICLO_LANZADO', 'CICLO_CERRADO', 'CICLO_PAIS_PUBLICADO', 'CICLO_EVALUACIONES_EDITADAS',
      'CICLO_ROTACION_RETIRO', 'CICLO_ROTACION_REASIGNACION', 'CICLO_RESULTADOS_EXPORTADO',
      'EVALUACION_INVALIDADA', 'EVALUACION_REHABILITADA', 'CALIBRACION',
      'NOTA_CONFORMIDAD', 'NOTA_OBSERVADA', 'CONFORMIDAD_EXIMIDA', 'CONFORMIDAD_EXENCION_RETIRADA',
      'PAR_ASIGNADO', 'PAR_APROBADO', 'PAR_RECHAZADO', 'PAR_RETIRADO',
      'PERIODO_CERRADO', 'PERIODO_PLAZO_EXTENDIDO', 'PERIODO_EXTENSION_INDIVIDUAL',
      'RESULTADOS_PUBLICADOS',
    ]) {
      expect(nivelDeRetencion(accion), accion).toBe('permanente')
    }
  })

  it('trata como ruido solo lo que pesa por volumen y no prueba un acceso', () => {
    expect(nivelDeRetencion('LOGIN_CODIGO_EMITIDO')).toBe('ruido')
    // Empieza por un prefijo permanente, pero no prueba nada de una evaluación
    expect(nivelDeRetencion('PERIODO_RECORDATORIOS')).toBe('ruido')
  })

  it('LOGIN_OK NO es ruido: prueba quién abrió la sesión que envió una evaluación', () => {
    expect(nivelDeRetencion('LOGIN_OK')).toBe('general')
  })

  it('la cadena de custodia del cálculo es permanente', () => {
    for (const a of ['OBJETIVO_EDITADO_RRHH', 'OBJETIVO_ELIMINADO_RRHH', 'CONFIG_ACTUALIZADA', 'BANCO_PREGUNTAS_IMPORTADO', 'DIMENSION_CREADA', 'NIVEL_ACTUALIZADO']) {
      expect(nivelDeRetencion(a), a).toBe('permanente')
    }
  })

  it('los accesos FALLIDOS no son ruido: son señal de seguridad y duran como el resto', () => {
    expect(nivelDeRetencion('LOGIN_FALLIDO')).toBe('general')
    expect(nivelDeRetencion('LOGIN_2FA_AGOTADO')).toBe('general')
  })

  it('el resto caduca al año', () => {
    for (const accion of [
      'COLABORADOR_CREADO', 'COLABORADOR_BAJA', 'USUARIO_CREADO', 'USUARIO_EMAIL_CAMBIADO',
      'USUARIO_PASSWORD_RESET', 'PASSWORD_CAMBIADO', 'ROL_CREADO',
      'IMPORTACION_MAESTRA', 'PUESTO_CREADO',
    ]) {
      expect(nivelDeRetencion(accion), accion).toBe('general')
    }
  })

  it('una acción nueva cae en «general» por defecto, nunca en ruido', () => {
    // Si mañana alguien añade una acción y olvida clasificarla, se conserva un año: el error
    // seguro es guardar de más, no borrar de más
    expect(nivelDeRetencion('ALGO_QUE_NO_EXISTIA')).toBe('general')
  })
})
