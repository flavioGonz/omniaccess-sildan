/*
 * El Monitor en vivo de Filas es la pantalla que antes era Reportes, rediseñada (Nico, HB 19/10:
 * «Reportes será la sección Monitor en vivo mejorada»). El mosaico de cámaras que vivía acá se
 * retiró: el video de cada fila está en Filas. Una sola implementación, dos rutas: la del menú
 * (/admin/monitor-queue) y la vieja de Reportes, para enlaces guardados.
 */
export { default } from "../reportes-queue/page";
