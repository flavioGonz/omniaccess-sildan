import { fechaHora } from "@/lib/fechas";
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Quedó como envoltorio de `fechaHora` para no romper a quien la llame.
 *
 * Formateaba en `es-ES` y sin zona horaria: con el mismo dato, dos operadores en husos
 * distintos veían horas distintas. Lo que hay que mirar es la hora del BARRIO, que es
 * donde ocurren las cosas, y eso lo resuelve `@/lib/fechas` en un solo lugar.
 */
export function formatDate(date: Date | string) {
  return fechaHora(date);
}
