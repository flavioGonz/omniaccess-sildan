"use client";
/**
 * Lo que trae el panel de las rutas de usuarios de los equipos (openspec usuarios-de-equipos), con los
 * cuatro estados: cargando, error con reintento, vacío y con datos.
 */
import { useCallback, useEffect, useState } from "react";
import type { CuentaVista, SesionVista, LecturaVista } from "@/lib/usuarios-equipo/vista";

export type { CuentaVista, SesionVista, LecturaVista };
export type EquipoUsuarios = { id: string; name: string; ip: string; deviceType: string; brand: string; soporte: boolean; soloLectura: boolean };
export type FichaUsuarios = { equipo: EquipoUsuarios; lectura: LecturaVista | null; cuentas: CuentaVista[]; sesiones: SesionVista[] };
export type TodasUsuarios = {
    equipos: (EquipoUsuarios & { lectura: LecturaVista | null; sesiones: Record<string, number> })[];
    cuentas: CuentaVista[];
    alertas: { deviceId: string; type: string; message: string; openedAt: string }[];
};

async function pedir<T>(url: string): Promise<T> {
    const r = await fetch(url, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.error || `El servidor respondió ${r.status}`);
    return j as T;
}

export function useDatos<T>(url: string | null) {
    const [datos, setDatos] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cargando, setCargando] = useState(false);
    const traer = useCallback(async (extra = "") => {
        if (!url) return;
        setCargando(true); setError(null);
        try { setDatos(await pedir<T>(url + extra)); } catch (e: any) { setError(e?.message || "No se pudo leer"); }
        finally { setCargando(false); }
    }, [url]);
    useEffect(() => { void traer(); }, [traer]);
    return { datos, error, cargando, traer };
}

export async function marcarConocida(cuerpo: Record<string, unknown>) {
    const r = await fetch("/api/devices/usuarios/conocida", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.error || `El servidor respondió ${r.status}`);
    return j;
}
