"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Car, CarFront, Users, UserRound, LogOut, Undo2, Hand, CircleHelp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Filtros } from "@/components/ui/filtros";
import { Matricula, Momento, Estado, type Tono } from "@/components/ui/celdas";
import { Cronometro } from "@/components/tracking/Cronometro";
import type { Presencia, AutoAdentro, ResidenteAdentro, VisitaAdentro, ClasePresencia } from "@/lib/presencia";

/**
 * Quién está adentro del barrio (16/10, Nico, con un dibujo): cuatro tarjetas en la cabecera del
 * Monitor LPR — autos de residentes, residentes, autos de visitas, visitas — y al tocar una, un
 * cajón con la lista: matrícula, quién, hora de ingreso y estadía corriendo. Desde el cajón el
 * guardia corrige: «salió» para un auto cuya salida no se leyó, o cierra una visita registrada.
 *
 * El cálculo vive en el servidor (lib/presencia.ts), con el porqué de cada criterio.
 */

export type ClavePresencia = "autosResidentes" | "residentes" | "autosVisitas" | "visitas";

/** Cada cuánto se recalcula sola, además de con cada lectura nueva. */
const REFRESCO_MS = 30_000;

const TARJETAS: { clave: ClavePresencia; rotulo: string; icono: typeof Car; ayuda: string }[] = [
    { clave: "autosResidentes", rotulo: "Autos de residentes", icono: Car, ayuda: "Autos del padrón cuya última lectura fue una entrada" },
    { clave: "residentes", rotulo: "Residentes", icono: Users, ayuda: "Residentes con un auto adentro, o que entraron a pie (rostro o tarjeta)" },
    { clave: "autosVisitas", rotulo: "Autos de visitas", icono: CarFront, ayuda: "Vehículos que no son de residentes: visitas, proveedores, personal y no registrados" },
    { clave: "visitas", rotulo: "Visitas", icono: UserRound, ayuda: "Visitas registradas por la guardia o por invitación, todavía abiertas" },
];

const TONO_CLASE: Record<ClasePresencia, Tono> = {
    residente: "bien", personal: "info", proveedor: "info", visita: "aviso", invitado: "aviso", lista_blanca: "bien", no_registrado: "mal",
};
const NOMBRE_CLASE: Record<ClasePresencia, string> = {
    residente: "Residente", personal: "Personal", proveedor: "Proveedor", visita: "Visita", invitado: "Invitado", lista_blanca: "Lista blanca", no_registrado: "No registrado",
};

/** Lo que lee la cabecera y el cajón: un solo pedido para los dos. */
export function usarPresencia(pulso?: string | null) {
    const [datos, setDatos] = useState<Presencia | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);
    const traer = useCallback(() => {
        fetch("/api/presencia", { cache: "no-store" })
            .then(async (r) => { const j = await r.json().catch(() => null); if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`); return j as Presencia; })
            .then((j) => { setDatos(j); setError(null); })
            .catch((e) => setError(e?.message || "No se pudo leer quién está adentro."))
            .finally(() => setCargando(false));
    }, []);
    useEffect(() => { traer(); const iv = setInterval(traer, REFRESCO_MS); return () => clearInterval(iv); }, [traer]);
    // Una lectura nueva puede cambiar quién está adentro: se recalcula, con un respiro para no
    // pedir diez veces cuando pasan varios autos seguidos.
    useEffect(() => { if (!pulso) return; const t = setTimeout(traer, 2500); return () => clearTimeout(t); }, [pulso, traer]);
    return { datos, error, cargando, traer };
}

export function TarjetasPresencia({ datos, cargando, alAbrir }: { datos: Presencia | null; cargando: boolean; alAbrir: (c: ClavePresencia) => void }) {
    return (
        <div className="flex items-stretch gap-2">
            {TARJETAS.map((t) => {
                const lista = (datos?.[t.clave] || []) as { estimado?: boolean; excedida?: boolean }[];
                const estimados = lista.filter((x) => x.estimado).length;
                const excedidas = lista.filter((x) => x.excedida).length;
                return (
                    <button key={t.clave} type="button" onClick={() => alAbrir(t.clave)} title={t.ayuda}
                        className="group flex items-center gap-2.5 h-[46px] pl-2.5 pr-3.5 rounded-[10px] bg-muted/60 hover:bg-muted text-left transition-colors">
                        <span className="grid place-items-center w-8 h-8 rounded-md bg-background text-muted-foreground group-hover:text-[var(--accion)] transition-colors"><t.icono size={16} /></span>
                        <span className="flex flex-col leading-tight">
                            <span className="text-[11px] text-muted-foreground whitespace-nowrap">{t.rotulo} <span className="opacity-70">adentro</span></span>
                            <span className="flex items-baseline gap-1.5">
                                <span className="text-[18px] font-bold tabular-nums tracking-tight">{cargando && !datos ? "…" : lista.length}</span>
                                {excedidas > 0 && <span className="text-[10.5px] font-semibold tono-mal tabular-nums">{excedidas} excedida{excedidas > 1 ? "s" : ""}</span>}
                                {!excedidas && estimados > 0 && <span className="text-[10.5px] text-muted-foreground tabular-nums" title="Sin una lectura reciente que lo confirme">{estimados} sin confirmar</span>}
                            </span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

/** El cajón: las cuatro listas, con búsqueda, y las correcciones del guardia. */
export function CajonPresencia({ abierto, clave, alCambiarClave, alCerrar, datos, error, cargando, alRecargar }: {
    abierto: boolean; clave: ClavePresencia; alCambiarClave: (c: ClavePresencia) => void; alCerrar: () => void;
    datos: Presencia | null; error: string | null; cargando: boolean; alRecargar: () => void;
}) {
    const [busqueda, setBusqueda] = useState("");
    const [hecho, setHecho] = useState<{ texto: string; deshacer?: () => void } | null>(null);
    const [ocupado, setOcupado] = useState<string | null>(null);
    const [fallo, setFallo] = useState<string | null>(null);
    useEffect(() => { if (!abierto) { setHecho(null); setFallo(null); } }, [abierto]);

    const mandar = useCallback(async (cuerpo: Record<string, string>, id: string) => {
        setOcupado(id); setFallo(null);
        try {
            const r = await fetch("/api/presencia", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
            const j = await r.json().catch(() => null);
            if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
            alRecargar();
            return true;
        } catch (e: any) { setFallo(e?.message || "No se pudo guardar."); return false; }
        finally { setOcupado(null); }
    }, [alRecargar]);

    const salio = useCallback(async (a: AutoAdentro) => {
        if (await mandar({ plate: a.plate, estado: "AFUERA" }, a.plate))
            setHecho({ texto: `${a.plate} marcado afuera`, deshacer: () => { void mandar({ plate: a.plate, estado: "ADENTRO" }, a.plate); setHecho(null); } });
    }, [mandar]);
    const cerrarVisita = useCallback(async (v: { id: string; plate: string | null }) => {
        if (await mandar({ visitaId: v.id }, v.id)) setHecho({ texto: `Visita${v.plate ? ` de ${v.plate}` : ""} cerrada` });
    }, [mandar]);

    const t = busqueda.trim().toUpperCase();
    const pasa = (...campos: (string | null | undefined)[]) => !t || campos.some((c) => (c || "").toUpperCase().replace(/[^A-Z0-9 ]/g, "").includes(t.replace(/[^A-Z0-9 ]/g, "")));

    const colEntrada = <T extends { entrada: string }>(): ColumnaTabla<T>[] => [
        { clave: "entrada", titulo: "Ingreso", ancho: 96, valor: (x) => x.entrada, celda: (x) => <Momento t={x.entrada} />, ordenable: true },
        { clave: "estadia", titulo: "Estadía", ancho: 120, valor: (x) => String(Date.now() - new Date(x.entrada).getTime()), celda: (x) => <Cronometro desde={x.entrada} tamano="chico" /> },
    ];

    const colsAutos = useMemo<ColumnaTabla<AutoAdentro>[]>(() => [
        { clave: "plate", titulo: "Matrícula", ancho: 130, valor: (a) => a.plate, celda: (a) => (
            <div className="flex flex-col items-start gap-1">
                <Matricula p={a.plate} />
                {a.marcaManual ? <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground"><Hand size={10} /> a mano</span>
                    : a.estimado ? <span className="inline-flex items-center gap-1 text-[10.5px] tono-aviso" title="La entrada es vieja y ninguna cámara la volvió a ver: puede haber salido sin que se leyera"><CircleHelp size={10} /> sin confirmar</span> : null}
            </div>) },
        { clave: "quien", titulo: "Quién", valor: (a) => [a.persona, a.unidad, NOMBRE_CLASE[a.clase]].filter(Boolean).join(" · "), celda: (a) => (
            <div className="min-w-0 leading-tight">
                <div className="text-[13px] font-semibold truncate">{a.persona || <span className="text-muted-foreground font-normal">Sin datos</span>}</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                    {a.clase !== "residente" && <Estado tono={TONO_CLASE[a.clase]}>{NOMBRE_CLASE[a.clase]}</Estado>}
                    {a.unidad && <span className="text-[11px] text-muted-foreground truncate">{a.unidad}</span>}
                </div>
            </div>) },
        ...colEntrada<AutoAdentro>(),
        { clave: "visto", titulo: "Última lectura", ancho: 150, valor: (a) => a.vistoUltimo, celda: (a) => (
            <div className="leading-tight min-w-0"><Momento t={a.vistoUltimo} />{a.camara && <div className="text-[10.5px] text-muted-foreground truncate">{a.camara}</div>}</div>) },
        { clave: "accion", titulo: "", ancho: 118, auxiliar: true, alinear: "der", celda: (a) => (
            <div className="flex justify-end gap-1.5">
                {a.visitaId
                    ? <button type="button" disabled={ocupado === a.visitaId} onClick={(e) => { e.stopPropagation(); void cerrarVisita({ id: a.visitaId!, plate: a.plate }); }}
                        className="h-7 px-2.5 rounded-md text-[12px] font-semibold inline-flex items-center gap-1 text-[var(--accion)] hover:bg-accent disabled:opacity-50"><LogOut size={13} /> Cerrar visita</button>
                    : <button type="button" disabled={ocupado === a.plate} onClick={(e) => { e.stopPropagation(); void salio(a); }} title="La salida no se leyó: marcarlo afuera hasta su próxima lectura"
                        className="h-7 px-2.5 rounded-md text-[12px] font-semibold inline-flex items-center gap-1 text-[var(--accion)] hover:bg-accent disabled:opacity-50"><LogOut size={13} /> Salió</button>}
            </div>) },
    ], [ocupado, salio, cerrarVisita]); // eslint-disable-line react-hooks/exhaustive-deps

    const colsResidentes = useMemo<ColumnaTabla<ResidenteAdentro>[]>(() => [
        { clave: "nombre", titulo: "Residente", valor: (r) => r.nombre, celda: (r) => (
            <div className="leading-tight min-w-0">
                <div className="text-[13px] font-semibold truncate">{r.nombre}</div>
                <div className="text-[11px] text-muted-foreground truncate">{r.unidad || "Sin unidad"}{r.estimado ? " · sin confirmar" : ""}</div>
            </div>) },
        { clave: "autos", titulo: "Con", valor: (r) => r.autos.join(" "), celda: (r) => r.autos.length
            ? <div className="flex flex-wrap gap-1">{r.autos.map((p) => <Matricula key={p} p={p} />)}</div>
            : <span className="text-[12px] text-muted-foreground">A pie</span> },
        ...colEntrada<ResidenteAdentro>(),
    ], []); // eslint-disable-line react-hooks/exhaustive-deps

    const colsVisitas = useMemo<ColumnaTabla<VisitaAdentro>[]>(() => [
        { clave: "plate", titulo: "Matrícula", ancho: 120, valor: (v) => v.plate || "", celda: (v) => <Matricula p={v.plate} /> },
        { clave: "quien", titulo: "Quién", valor: (v) => [v.nombre, v.empresa, v.lote].filter(Boolean).join(" · "), celda: (v) => (
            <div className="leading-tight min-w-0">
                <div className="text-[13px] font-semibold truncate">{v.nombre || v.empresa || <span className="text-muted-foreground font-normal">Sin nombre</span>}</div>
                <div className="flex items-center gap-1.5 mt-0.5"><Estado tono="aviso">{v.tipoNombre}</Estado>{v.lote && <span className="text-[11px] text-muted-foreground truncate">{v.lote}</span>}</div>
            </div>) },
        ...colEntrada<VisitaAdentro>(),
        { clave: "vence", titulo: "Vence", ancho: 96, valor: (v) => v.vence, celda: (v) => <div className={cn(v.excedida && "tono-mal")}><Momento t={v.vence} />{v.excedida && <div className="text-[10.5px] font-semibold">excedida</div>}</div> },
        { clave: "accion", titulo: "", ancho: 120, auxiliar: true, alinear: "der", celda: (v) => (
            <button type="button" disabled={ocupado === v.id} onClick={(e) => { e.stopPropagation(); void cerrarVisita(v); }}
                className="h-7 px-2.5 rounded-md text-[12px] font-semibold inline-flex items-center gap-1 text-[var(--accion)] hover:bg-accent disabled:opacity-50"><LogOut size={13} /> Cerrar visita</button>) },
    ], [ocupado, cerrarVisita]); // eslint-disable-line react-hooks/exhaustive-deps

    const cuenta = (c: ClavePresencia) => (datos?.[c] || []).length;
    const opciones = TARJETAS.map((x) => ({ valor: x.clave, rotulo: x.rotulo, cuenta: datos ? cuenta(x.clave) : undefined, icono: x.icono }));
    const comun = { cargando: cargando && !datos, error: !datos ? error : null, alReintentar: alRecargar, alto: "100%", className: "flex-1 min-h-0", controles: false, seleccionCeldas: false };
    const vacio = (que: string) => ({ titulo: t ? "Nada con esa búsqueda" : `No hay ${que} adentro`, ayuda: t ? undefined : "Se actualiza con cada lectura." });

    const descripcion = datos?.modo === "ABIERTO"
        ? `Barrio abierto: la salida no siempre se lee. Un auto de residente se busca ${datos.ventanas.residentesDias} días para atrás; uno que no es del barrio se da por ido a las ${datos.ventanas.visitasHoras} h. «Salió» corrige hasta su próxima lectura.`
        : "Por la última lectura permitida de cada matrícula. «Salió» corrige un auto cuya salida no se leyó, hasta su próxima lectura.";

    return (
        <Cajon open={abierto} onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <CajonContenido ancho="ancho" titulo="Quién está adentro" descripcion={descripcion}>
                <div className="flex flex-col gap-3 h-full min-h-0 p-5">
                    <Filtros busqueda={busqueda} alBuscar={setBusqueda} placeholder="Matrícula, nombre o lote"
                        grupos={[{ clave: "lista", titulo: "Qué lista", valor: clave, alElegir: (v) => alCambiarClave(v as ClavePresencia), opciones }]} />
                    {(hecho || fallo) && (
                        <div className={cn("flex items-center gap-2 h-9 px-3 rounded-md text-[12.5px]", fallo ? "chip-mal" : "bg-muted/60")}>
                            <span className="flex-1 truncate">{fallo || hecho?.texto}</span>
                            {!fallo && hecho?.deshacer && <button type="button" onClick={hecho.deshacer} className="inline-flex items-center gap-1 font-semibold text-[var(--accion)]"><Undo2 size={13} /> Deshacer</button>}
                        </div>
                    )}
                    {clave === "residentes" ? (
                        <Tabla<ResidenteAdentro> {...comun} id="presencia-residentes" filas={(datos?.residentes || []).filter((r) => pasa(r.nombre, r.unidad, ...r.autos))} clave={(r) => r.userId} columnas={colsResidentes} vacio={vacio("residentes")} />
                    ) : clave === "visitas" ? (
                        <Tabla<VisitaAdentro> {...comun} id="presencia-visitas" filas={(datos?.visitas || []).filter((v) => pasa(v.plate, v.nombre, v.empresa, v.lote, v.tipoNombre))} clave={(v) => v.id} columnas={colsVisitas} vacio={vacio("visitas")} />
                    ) : (
                        <Tabla<AutoAdentro> {...comun} id={`presencia-${clave}`} filas={((clave === "autosResidentes" ? datos?.autosResidentes : datos?.autosVisitas) || []).filter((a) => pasa(a.plate, a.persona, a.unidad, NOMBRE_CLASE[a.clase]))}
                            clave={(a) => a.plate} columnas={colsAutos} vacio={vacio(clave === "autosResidentes" ? "autos de residentes" : "autos de visitas")} />
                    )}
                </div>
            </CajonContenido>
        </Cajon>
    );
}
