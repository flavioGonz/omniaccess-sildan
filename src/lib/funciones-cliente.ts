"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getFunciones } from "@/app/actions/funciones";
import { estadoEfectivo, type FuncionId } from "@/lib/funciones";

/**
 * Las funciones de los módulos (lib/funciones) vistas desde el navegador: se piden UNA vez por
 * pestaña y las comparten todas las piezas que las miran. Las rutas del servidor usan
 * `funcionActiva`; esto es para mostrar u ocultar pantallas y botones.
 *
 * Antes de saberlas, `useFuncion` da `null`, y quien la usa la trata como apagada: con «Plazas de
 * parking» apagada en San Nicolás, el botón de plaza aparecía un instante y se iba — peor que
 * aparecer un instante tarde donde sí está prendida.
 */

let estado: Partial<Record<FuncionId, boolean>> | null = null;
let pidiendo = false;
const oyentes = new Set<() => void>();
const avisar = () => { for (const o of oyentes) o(); };

export function refrescarFunciones() {
    if (pidiendo) return;
    pidiendo = true;
    getFunciones().then((f) => { estado = f; avisar(); }).catch(() => { }).finally(() => { pidiendo = false; });
}

/** Un cambio hecho en Ajustes → Modos, para que el resto del panel lo vea sin recargar. */
export function fijarFuncion(id: FuncionId, valor: boolean) {
    estado = { ...(estado || {}), [id]: valor };
    avisar();
}

/**
 * El estado EFECTIVO: prendida y con aquello de lo que depende prendido (la Gestión de alarmas con la
 * Recepción apagada da false aunque su ajuste diga true). Ajustes → Modos lee lo guardado aparte.
 */
const efectiva = (id: FuncionId): boolean | null => (estado ? estadoEfectivo(id, estado) : null);

export function useFuncion(id: FuncionId): boolean | null {
    const v = useSyncExternalStore(
        (cb) => { oyentes.add(cb); return () => { oyentes.delete(cb); }; },
        () => efectiva(id),
        () => null,
    );
    useEffect(() => { if (!estado) refrescarFunciones(); }, []);
    return v;
}
