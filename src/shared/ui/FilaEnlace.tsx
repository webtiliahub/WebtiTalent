'use client'

import { useRouter } from 'next/navigation'

/** Fila de tabla que navega al hacer clic en cualquier punto (el destino también debe existir como <Link> real dentro, para teclado y abrir en pestaña nueva). */
export function FilaEnlace({ href, children, className = '' }: {
  href: string
  children: React.ReactNode
  className?: string
}) {
  const router = useRouter()
  return (
    <tr className={`cursor-pointer ${className}`} onClick={() => router.push(href)}>
      {children}
    </tr>
  )
}
