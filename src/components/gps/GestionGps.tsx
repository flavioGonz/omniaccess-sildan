"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Car, CircleDashed, FileSpreadsheet, Map as MapaIcono, Menu, SlidersHorizontal, TerminalSquare } from "lucide-react";
import { rastreadoresGps, type Rastreador } from "@/app/actions/gps";
import { Cargando, ErrorEstado } from "@/components/ui/estados";
import { PanelReportesGps } from "@/components/mapa/ReportesGps";
import { useSessionRole } from "@/hooks/useSessionRole";
import { puedeGps, type QueGps } from "@/lib/gps-permisos";
import { cn } from "@/lib/utils";
import { AjustesGps } from "@/components/gps/AjustesGps";
import { ComandosGps } from "@/components/gps/ComandosGps";
import { estadoDe } from "@/components/gps/piezas";
import { VehiculosGps } from "@/components/gps/VehiculosGps";
import { ZonasGps } from "@/components/gps/ZonasGps";

/**
 * Gestión GPS: la pantalla de la flota (23/11).
 *
 * Nico, después de ver todo lo que le falta a OmniAccess para parecerse a una plataforma de rastreo:
 * «creo que tenemos que generar un elemento del menú nuevo, Gestión GPS, para poder plasmar todo
 * esto, ¿no?». Tenía razón: lo del GPS estaba repartido en tres lugares —una capa del mapa, una
 * pestaña de Dispositivos y un cajón de reportes— y no había dónde poner lo que viene (puntos de
 * interés, conductores, la ficha del vehículo).
 *
 * Es UNA entrada del menú con pestañas adentro, no seis entradas: el menú ya tiene treinta.
 *
 * Y su segundo pedido, del mismo día: «100% usable vía celulares, súper adaptado». Por eso en el
 * celular las pestañas son una barra pegada ABAJO, al alcance del pulgar, como en una aplicación; en
 * el escritorio van arriba, donde se las busca con el mouse. La pestaña vive en la dirección
 * (`?t=comandos&v=<imei>`): un enlace lleva derecho al lugar, y volver atrás vuelve a la pestaña.
 *
 * El mapa sigue siendo el lugar del vivo: desde acá se salta a él, no se lo duplica.
 */

const PESTANAS = [
    { clave: "vehiculos", rotulo: "Vehículos", icono: Car },
    { clave: "zonas", rotulo: "Zonas", icono: CircleDashed },
    { clave: "reportes", rotulo: "Reportes", icono: FileSpreadsheet },
    { clave: "comandos", rotulo: "Comandos", icono: TerminalSquare },
    { clave: "ajustes", rotulo: "Ajustes", icono: SlidersHorizontal },
] as const;
type Pestana = (typeof PESTANAS)[number]["clave"];
const esPestana = (x: string | null): x is Pestana => PESTANAS.some((p) => p.clave === x);

/** Cada cuánto se vuelve a pedir la lista. Lo mismo que el mapa. */
const REFRESCO_MS = 15_000;

export function GestionGps() {
    const [pestana, setPestana] = useState<Pestana>("vehiculos");
    /** El vehículo con el que se llega a Comandos o a Reportes desde su ficha. */
    const [imei, setImei] = useState<string | null>(null);

    /* La dirección manda: al entrar, al volver atrás y cuando el menú lateral lleva a otra pestaña de
       esta misma pantalla (cada pestaña es un sub-elemento del módulo, con su enlace). Next mantiene
       `useSearchParams` al día también con lo que se escribe acá con pushState. */
    const consulta = useSearchParams();
    const tUrl = consulta?.get("t") ?? null, vUrl = consulta?.get("v") ?? null;
    useEffect(() => { setPestana(esPestana(tUrl) ? tUrl : "vehiculos"); setImei(vUrl); }, [tUrl, vUrl]);
    const ir = useCallback((t: Pestana, v: string | null = null) => {
        setPestana(t); setImei(v);
        const q = new URLSearchParams();
        if (t !== "vehiculos") q.set("t", t);
        if (v) q.set("v", v);
        window.history.pushState(null, "", `${window.location.pathname}${q.size ? `?${q}` : ""}`);
        /* Cada pestaña arranca desde arriba: quedar a mitad de la página anterior desorienta. */
        document.getElementById("gps-arriba")?.scrollIntoView({ block: "start" });
    }, []);

    /* ── La flota ── */
    const [lista, setLista] = useState<Rastreador[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const pidiendo = useRef(false);
    const traer = useCallback(async () => {
        if (pidiendo.current) return;
        pidiendo.current = true;
        try { setLista(await rastreadoresGps()); setError(null); }
        catch (e) { setError(e instanceof Error ? e.message : "No se pudo traer la flota."); }
        finally { pidiendo.current = false; }
    }, []);
    useEffect(() => {
        traer();
        /* Con la pestaña del navegador escondida no se pide nada: un celular en el bolsillo no tiene por qué gastar datos. */
        const iv = setInterval(() => { if (document.visibilityState === "visible") traer(); }, REFRESCO_MS);
        const alVolver = () => { if (document.visibilityState === "visible") traer(); };
        document.addEventListener("visibilitychange", alVolver);
        return () => { clearInterval(iv); document.removeEventListener("visibilitychange", alVolver); };
    }, [traer]);

    const { efectivos, loaded } = useSessionRole();
    const puede = useCallback((que: QueGps) => puedeGps(efectivos, que), [efectivos]);

    const resumen = useMemo(() => {
        const deAlta = (lista || []).filter((r) => r.deviceId);
        const n = { andando: 0, detenido: 0, "sin-reportar": 0, "sin-alta": 0 };
        for (const r of lista || []) n[estadoDe(r).clave]++;
        return { total: deAlta.length, ...n };
    }, [lista]);
    const deAlta = useMemo(() => (lista || []).filter((r) => r.deviceId), [lista]);

    return (
        /* --gps-barra es el alto de la barra de pestañas del celular: lo usan los pies pegados abajo
           (los botones de bajar un reporte) para no quedar tapados por ella. */
        <div className="flex min-h-full flex-col [--gps-barra:calc(60px+env(safe-area-inset-bottom))] sm:[--gps-barra:0px]">
            <span id="gps-arriba" />
            <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
                <div className="flex items-center gap-3 px-4 pb-3 pt-4 sm:px-6">
                    {/* En el celular el menú de OmniAccess se llama desde acá: la pestaña del borde es fina para un pulgar. */}
                    <button type="button" onClick={() => window.dispatchEvent(new Event("oa:menu"))} aria-label="Abrir el menú de OmniAccess"
                        className="-ml-1.5 grid h-10 w-10 shrink-0 place-items-center rounded-[6px] text-muted-foreground hover:bg-accent sm:hidden"><Menu size={20} /></button>
                    <div className="min-w-0 flex-1">
                        <h1 className="text-[19px] font-bold leading-tight tracking-tight sm:text-[21px]">Gestión GPS</h1>
                        <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
                            {lista === null ? "Trayendo la flota…"
                                : !resumen.total ? "Sin vehículos dados de alta"
                                : <>{resumen.total} {resumen.total === 1 ? "vehículo" : "vehículos"}{resumen.andando > 0 && <> · <span className="tono-bien font-semibold">{resumen.andando} andando</span></>}{resumen["sin-reportar"] > 0 && <> · <span className="tono-mal font-semibold">{resumen["sin-reportar"]} sin reportar</span></>}</>}
                        </p>
                    </div>
                    <Link href="/admin/mapa" className="inline-flex h-10 shrink-0 items-center gap-2 rounded-[6px] border border-border px-3.5 text-[13px] font-semibold hover:bg-accent sm:h-9">
                        <MapaIcono size={16} /> Mapa
                    </Link>
                </div>
                {/* Escritorio: las pestañas arriba. */}
                <nav className="hidden gap-1 px-4 sm:flex sm:px-6" aria-label="Secciones de Gestión GPS">
                    {PESTANAS.map((p) => (
                        <button key={p.clave} type="button" onClick={() => ir(p.clave)} aria-current={pestana === p.clave ? "page" : undefined}
                            className={cn("-mb-px flex h-10 items-center gap-2 border-b-2 px-3 text-[13px] font-semibold", pestana === p.clave ? "border-[var(--accion)] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                            <p.icono size={15} /> {p.rotulo}
                        </button>
                    ))}
                </nav>
            </header>

            <div className="flex-1 px-4 pb-[calc(var(--gps-barra)+20px)] pt-4 sm:px-6 sm:pb-8">
                {error && lista === null ? <ErrorEstado titulo="No se pudo traer la flota" mensaje={error} alReintentar={traer} />
                    : lista === null || !loaded ? <Cargando texto="Trayendo la flota…" />
                    : (
                        <>
                            {/* Si la lista ya está y un refresco falla, se sigue mostrando lo último que se supo, y se dice. */}
                            {error && <p className="chip-aviso mb-3 rounded-[6px] border px-3 py-2 text-[12.5px]">No se pudo actualizar: lo que se ve es lo último que se supo. <button type="button" onClick={traer} className="font-semibold underline">Reintentar</button></p>}
                            {pestana === "vehiculos" && <VehiculosGps lista={lista} puede={puede} alCambiar={traer} alIr={(p, v) => ir(p, v)} />}
                            {pestana === "zonas" && <ZonasGps lista={lista} puedeConfig={puede("config")} />}
                            {/* `key`: llegar desde la ficha de otro vehículo arma el panel de nuevo, con ese vehículo elegido. */}
                            {pestana === "reportes" && <PanelReportesGps key={imei || "todos"} rastreadores={deAlta} inicio={imei ? { imeis: [imei] } : undefined} />}
                            {pestana === "comandos" && <ComandosGps lista={lista} imei={imei} alElegir={(v) => ir("comandos", v)} puede={puede} alCambiar={traer} />}
                            {pestana === "ajustes" && <AjustesGps puedeConfig={puede("config")} puedeEquipo={puede("equipo")} />}
                        </>
                    )}
            </div>

            {/* Celular: las pestañas abajo, donde llega el pulgar. */}
            <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden" aria-label="Secciones de Gestión GPS">
                {PESTANAS.map((p) => (
                    <button key={p.clave} type="button" onClick={() => ir(p.clave)} aria-current={pestana === p.clave ? "page" : undefined}
                        className={cn("flex h-[60px] flex-col items-center justify-center gap-1 text-[10.5px] font-semibold", pestana === p.clave ? "text-[var(--accion)]" : "text-muted-foreground")}>
                        <p.icono size={20} strokeWidth={pestana === p.clave ? 2.4 : 2} />
                        {p.rotulo}
                    </button>
                ))}
            </nav>
        </div>
    );
}
