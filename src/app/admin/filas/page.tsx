"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Rows3, Plus, SlidersHorizontal, Users, RefreshCw } from "lucide-react";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Button } from "@/components/ui/button";
import { getResumenFilas } from "@/app/actions/queue";
import { CajonFila, tonoFila, ROTULO_TONO, type ResumenFila } from "@/components/queue/CajonFila";
import { CajonContadorFila } from "@/components/devices/CajonContadorFila";
import { hace, hora } from "@/lib/fechas";
import { cn } from "@/lib/utils";

/**
 * Filas: una tabla con una fila por cola, y cada una abre su ficha.
 *
 * Pedido de Nico (HB, 19/10): «debe ser una tabla, con cada fila mejor, no un video; debe poder
 * abrir su ficha, donde tendrá sus analíticas de aforo, entrada y salida». La pantalla anterior
 * (video grande con las zonas de la cámara, umbrales y analíticas ONVIF) sigue entera en
 * /admin/filas/avanzado, a un botón: no se perdió nada, sólo dejó de ser lo primero que se ve.
 */

/** Cada cuánto se refresca la tabla. Es un resumen chico: no pesa en el LTE. */
const REFRESCO_MS = 10_000;


export default function FilasPage() {
    const [filas, setFilas] = useState<ResumenFila[]>([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [abierta, setAbierta] = useState<ResumenFila | null>(null);
    const [alta, setAlta] = useState(false);

    const cargar = useCallback(async () => {
        try { setFilas(await getResumenFilas()); setError(null); }
        catch (e: any) { setError(e?.message || "No se pudieron leer las filas"); }
        finally { setCargando(false); }
    }, []);
    useEffect(() => { cargar(); const t = setInterval(cargar, REFRESCO_MS); return () => clearInterval(t); }, [cargar]);

    const columnas: ColumnaTabla<ResumenFila>[] = [
        {
            clave: "fila", titulo: "Fila", valor: (f) => f.nombre,
            celda: (f) => (
                <div className="flex items-center gap-3 min-w-0">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-muted"><Users size={16} className="text-muted-foreground" /></span>
                    <div className="min-w-0">
                        <div className="text-[13px] font-semibold truncate">{f.nombre}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{f.ubicacion || f.ip}</div>
                    </div>
                </div>
            ),
        },
        {
            clave: "ahora", titulo: "Ahora", ayuda: "Personas en la zona de la fila contra su límite.", ancho: 220,
            valor: (f) => f.aforo ?? "",
            celda: (f) => {
                const t = tonoFila(f.aforo, f.limite);
                const pct = f.aforo == null ? 0 : Math.min(100, Math.round((f.aforo / f.limite) * 100));
                return (
                    <div className="flex items-center gap-3">
                        <span className={cn("text-[20px] font-bold tabular-nums leading-none w-8 text-right", `tono-${t}`)}>{f.aforo ?? "—"}</span>
                        <div className="flex-1 min-w-[80px]">
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className={cn("h-full rounded-full transition-[width] duration-700", `pleno-${t}`)} style={{ width: `${pct}%` }} /></div>
                            <div className="text-[11px] text-muted-foreground mt-1 tabular-nums">de {f.limite}</div>
                        </div>
                    </div>
                );
            },
        },
        {
            clave: "estado", titulo: "Estado", ancho: 110, valor: (f) => ROTULO_TONO[tonoFila(f.aforo, f.limite)],
            celda: (f) => { const t = tonoFila(f.aforo, f.limite); return <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full border", `chip-${t}`)}>{ROTULO_TONO[t]}</span>; },
        },
        { clave: "espera", titulo: "Espera", ayuda: "Estimada: personas en la fila ÷ ritmo de salidas de los últimos 15 minutos.", alinear: "der", ancho: 90, valor: (f) => (f.esperaMin == null ? "" : f.esperaMin), celda: (f) => <span className="tabular-nums">{f.esperaMin == null ? "—" : `${f.esperaMin} min`}</span> },
        { clave: "entradas", titulo: "Entradas hoy", alinear: "der", ancho: 110, valor: (f) => f.entradasHoy, celda: (f) => <span className="tabular-nums font-semibold">{f.entradasHoy}</span> },
        { clave: "salidas", titulo: "Salidas hoy", alinear: "der", ancho: 110, valor: (f) => f.salidasHoy, celda: (f) => <span className="tabular-nums font-semibold">{f.salidasHoy}</span> },
        {
            clave: "pico", titulo: "Pico hoy", alinear: "der", ancho: 120, valor: (f) => f.picoHoy,
            celda: (f) => <span className="tabular-nums"><b>{f.picoHoy}</b>{f.picoHoyA && <span className="text-muted-foreground text-[11px]"> · {hora(f.picoHoyA)}</span>}</span>,
        },
        { clave: "llenas", titulo: "Se llenó", ayuda: "Veces que llegó a su límite hoy.", alinear: "der", ancho: 90, valor: (f) => f.llenasHoy, celda: (f) => <span className={cn("tabular-nums font-semibold", f.llenasHoy > 0 && "tono-mal")}>{f.llenasHoy}</span> },
        { clave: "dato", titulo: "Último dato", alinear: "der", ancho: 120, valor: (f) => (f.ultimoDato ? new Date(f.ultimoDato).toISOString() : ""), celda: (f) => <span className="text-[12px] text-muted-foreground">{f.ultimoDato ? hace(f.ultimoDato) : "—"}</span> },
    ];

    return (
        <div className="p-6 space-y-5 max-w-[1680px] mx-auto">
            <div className="flex items-center gap-3">
                <div>
                    <h1 className="text-[28px] font-bold tracking-[-0.02em] leading-tight">Filas</h1>
                    <p className="text-[13px] text-muted-foreground">Cada cola que se cuenta. Abrí una para ver su aforo, entradas y salidas.</p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={cargar} title="Actualizar"><RefreshCw size={14} /></Button>
                    <Button variant="outline" size="sm" asChild className="gap-1.5">
                        <Link href="/admin/filas/avanzado"><SlidersHorizontal size={14} /> Umbrales y analíticas</Link>
                    </Button>
                    <Button size="sm" onClick={() => setAlta(true)} className="gap-1.5"><Plus size={14} /> Agregar fila</Button>
                </div>
            </div>

            <Tabla<ResumenFila>
                id="filas-resumen"
                filas={filas}
                clave={(f) => f.id}
                columnas={columnas}
                cargando={cargando}
                error={error}
                alReintentar={cargar}
                alClickFila={setAbierta}
                filaActiva={(f) => abierta?.id === f.id}
                filasFantasma={2}
                nombreArchivo="filas"
                vacio={{ icono: Rows3, titulo: "Todavía no hay filas", ayuda: "Agregá una cámara Bosch que cuente la fila con «Agregar fila»." }}
            />

            <CajonFila fila={abierta} open={!!abierta} onOpenChange={(v) => !v && setAbierta(null)} />
            <CajonContadorFila open={alta} onOpenChange={setAlta} onSuccess={cargar} />
        </div>
    );
}
