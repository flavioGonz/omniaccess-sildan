"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, FileSpreadsheet, History, Loader2, MapPin, Radio, Satellite, Share2, TerminalSquare } from "lucide-react";
import { sileo as toast } from "sileo";
import { atarVehiculoGps, cambiarIconoGps, renombrarGps, type Rastreador } from "@/app/actions/gps";
import { Button } from "@/components/ui/button";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { Vacio } from "@/components/ui/estados";
import { Seek } from "@/components/ui/search";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { CompartirGps } from "@/components/mapa/CompartirGps";
import type { QueGps } from "@/lib/gps-permisos";
import { hace } from "@/lib/fechas";
import { cn } from "@/lib/utils";
import { CAMPO, ChipEstado, Dato, estadoDe, ICONOS_GPS, Insignia, nombreDe, pildora, quedoAhi, ROTULO, SENAL, Tira, VOLTAJE_BAJO, voltios, type ClaveEstado } from "@/components/gps/piezas";

/**
 * Los vehículos de la flota: en qué anda cada uno, ahora.
 *
 * Es la lista que estaba en Dispositivos › GPS, pensada al revés. Allá el sujeto era el aparato
 * (IMEI, señal, dar de alta) y lo leía quien instala. Acá el sujeto es el vehículo y lo lee quien
 * administra la flota, casi siempre desde el celular: dónde está, si anda, hace cuánto se supo.
 *
 * En el celular son fichas apiladas y no una tabla. En el escritorio, la tabla de la casa: se
 * ordena, se copia y se exporta. Las dos salen de la misma lista y abren la misma ficha.
 */

type Filtro = "todos" | ClaveEstado;

export function VehiculosGps({ lista, puede, alCambiar, alIr }: {
    lista: Rastreador[];
    puede: (que: QueGps) => boolean;
    alCambiar: () => void;
    /** Saltar a otra pestaña con este vehículo ya elegido. */
    alIr: (pestana: "comandos" | "reportes", imei: string) => void;
}) {
    const [q, setQ] = useState("");
    const [filtro, setFiltro] = useState<Filtro>("todos");
    const [fichaDe, setFichaDe] = useState<string | null>(null);

    const cuenta = useMemo(() => {
        const c: Record<Filtro, number> = { todos: lista.length, andando: 0, detenido: 0, "sin-reportar": 0, "sin-alta": 0 };
        for (const r of lista) c[estadoDe(r).clave]++;
        return c;
    }, [lista]);
    const filas = useMemo(() => {
        const t = q.trim().toLowerCase();
        return lista
            .filter((r) => filtro === "todos" || estadoDe(r).clave === filtro)
            .filter((r) => !t || [r.nombre, r.matricula, r.imei, r.direccion].some((x) => (x || "").toLowerCase().includes(t)));
    }, [lista, filtro, q]);
    const deLaFicha = fichaDe ? lista.find((r) => r.imei === fichaDe) || null : null;

    const columnas = useMemo<ColumnaTabla<Rastreador>[]>(() => [
        { clave: "vehiculo", titulo: "Vehículo", ordenable: true, valor: (r) => nombreDe(r),
            celda: (r) => (
                <span className="flex min-w-0 items-center gap-3">
                    <Insignia r={r} tam={34} />
                    <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold">{nombreDe(r)}</span>
                        <span className="block truncate text-[11.5px] tabular-nums text-muted-foreground">{r.matricula || `IMEI ${r.imei}`}</span>
                    </span>
                </span>
            ) },
        { clave: "estado", titulo: "Estado", ordenable: true, valor: (r) => (estadoDe(r).clave === "andando" ? `Andando ${r.velocidad} km/h` : estadoDe(r).rotulo), celda: (r) => <ChipEstado r={r} /> },
        { clave: "donde", titulo: "Dónde está", valor: (r) => r.direccion || (r.lat !== null && r.lon !== null ? `${r.lat.toFixed(5)}, ${r.lon.toFixed(5)}` : ""),
            celda: (r) => (r.lat === null || r.lon === null ? <span className="text-[12px] text-muted-foreground">Sin satélites todavía</span> : (
                <span className="block max-w-[300px]">
                    <span className="block truncate text-[12.5px] font-semibold">{r.direccion || <span className="tabular-nums">{r.lat.toFixed(5)}, {r.lon.toFixed(5)}</span>}</span>
                    <span className="block text-[11.5px] text-muted-foreground">de {hace(r.cuando)}</span>
                </span>
            )) },
        { clave: "motor", titulo: "Motor", valor: (r) => (r.encendido === null ? "" : r.encendido ? "Encendido" : "Apagado"),
            celda: (r) => (r.encendido === null ? <span className="text-muted-foreground">—</span> : <span className={cn("text-[12.5px] font-semibold", r.encendido ? "tono-bien" : "text-muted-foreground")}>{r.encendido ? "Encendido" : "Apagado"}</span>) },
        { clave: "bateria", titulo: "Batería", alinear: "der", ordenable: true, valor: (r) => r.voltaje ?? "",
            celda: (r) => (r.voltaje === null ? <span className="text-muted-foreground">—</span> : <span className={cn("text-[12.5px] font-semibold tabular-nums", r.voltaje < VOLTAJE_BAJO && "tono-aviso")}>{voltios(r.voltaje)}</span>) },
        { clave: "reporto", titulo: "Reportó", valor: (r) => hace(r.ultimoLatido, "nunca"), celda: (r) => <span className="whitespace-nowrap text-[12.5px] text-muted-foreground">{hace(r.ultimoLatido, "nunca")}</span> },
        { clave: "ir", titulo: "", auxiliar: true, ancho: 36, celda: () => <ChevronRight size={15} className="text-muted-foreground" /> },
    ], []);

    const FILTROS: [Filtro, string][] = [["todos", "Todos"], ["andando", "Andando"], ["detenido", "Detenidos"], ["sin-reportar", "Sin reportar"], ["sin-alta", "Sin dar de alta"]];
    const sinNada = !lista.length;
    const vacio = sinNada
        ? { icono: Satellite, titulo: "Todavía no hay ningún rastreador", ayuda: "Un rastreador aparece acá cuando se conecta al receptor y alguien lo da de alta, en Dispositivos › GPS." }
        : { icono: Satellite, titulo: "Ninguno coincide", ayuda: "Probá con otro filtro o borrá la búsqueda." };

    return (
        <div className="space-y-3">
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
                <Tira label="Filtrar por estado" className="sm:flex-1">
                    {FILTROS.filter(([f]) => f === "todos" || cuenta[f] > 0).map(([f, rotulo]) => (
                        <button key={f} type="button" aria-pressed={filtro === f} onClick={() => setFiltro(f)} className={pildora(filtro === f)}>
                            {rotulo} <span className={cn("tabular-nums", filtro === f ? "opacity-70" : "opacity-60")}>{cuenta[f]}</span>
                        </button>
                    ))}
                </Tira>
                {lista.length > 4 && <span data-stroke="on" className="block"><Seek value={q} onChange={setQ} placeholder="Nombre, matrícula o calle" startOpen width={260} alto={36} /></span>}
            </div>

            {/* ── Celular: fichas ── */}
            <ul className="space-y-2 sm:hidden">
                {filas.length === 0 && <li><Vacio {...vacio} /></li>}
                {filas.map((r) => (
                    <li key={r.imei}>
                        <button type="button" onClick={() => setFichaDe(r.imei)} className="flex w-full items-start gap-3 rounded-[10px] border border-border bg-card/40 p-3 text-left active:bg-accent">
                            <Insignia r={r} tam={44} />
                            <span className="min-w-0 flex-1">
                                <span className="flex items-start justify-between gap-2">
                                    <span className="min-w-0">
                                        <span className="block truncate text-[15px] font-bold leading-tight">{nombreDe(r)}</span>
                                        {r.matricula && r.nombre && <span className="block text-[12.5px] tabular-nums text-muted-foreground">{r.matricula}</span>}
                                    </span>
                                    <ChipEstado r={r} />
                                </span>
                                <span className="mt-1.5 block text-[13px] leading-snug">{r.lat === null ? <span className="text-muted-foreground">Sin satélites todavía</span> : r.direccion || <span className="tabular-nums">{r.lat.toFixed(5)}, {r.lon!.toFixed(5)}</span>}</span>
                                <span className="mt-1 flex flex-wrap gap-x-2.5 text-[12px] text-muted-foreground">
                                    <span>{r.lat === null ? `reportó ${hace(r.ultimoLatido, "nunca")}` : `de ${hace(r.cuando)}`}</span>
                                    {r.encendido !== null && <span>motor {r.encendido ? "encendido" : "apagado"}</span>}
                                    {r.voltaje !== null && <span className={cn("tabular-nums", r.voltaje < VOLTAJE_BAJO && "tono-aviso font-semibold")}>{voltios(r.voltaje)}</span>}
                                    {r.cortado && <span className="tono-mal font-semibold">motor cortado</span>}
                                </span>
                            </span>
                        </button>
                    </li>
                ))}
            </ul>

            {/* ── Escritorio: la tabla ── */}
            <div className="hidden sm:block">
                <Tabla<Rastreador> id="gps-vehiculos" nombreArchivo="vehiculos-gps" filas={filas} clave={(r) => r.imei} columnas={columnas} alClickFila={(r) => setFichaDe(r.imei)}
                    filaActiva={(r) => r.imei === fichaDe} seleccionCeldas={false} vacio={vacio} />
            </div>

            <Cajon open={!!deLaFicha} onOpenChange={(o) => { if (!o) setFichaDe(null); }}>
                {deLaFicha && <Ficha r={deLaFicha} puede={puede} alCambiar={alCambiar} alIr={(p) => { setFichaDe(null); alIr(p, deLaFicha.imei); }} />}
            </Cajon>
        </div>
    );
}

/** La ficha de un vehículo: cómo está, adónde ir con él, y sus datos. En el celular ocupa la pantalla. */
function Ficha({ r, puede, alCambiar, alIr }: { r: Rastreador; puede: (que: QueGps) => boolean; alCambiar: () => void; alIr: (p: "comandos" | "reportes") => void }) {
    const conPosicion = r.lat !== null && r.lon !== null;
    const [compartiendo, setCompartiendo] = useState(false);
    const ACCION = "flex h-12 items-center gap-2.5 rounded-[10px] border border-border bg-card/40 px-3.5 text-[13.5px] font-semibold hover:bg-accent active:bg-accent";
    return (
        <CajonContenido ancho="angosto" titulo={nombreDe(r)} descripcion={r.matricula ? `${r.matricula} · IMEI ${r.imei}` : `IMEI ${r.imei}`}>
            <div className="space-y-6 px-4 py-5 sm:px-6">
                {/* ── Ahora ── */}
                <section>
                    <div className="flex items-center gap-3">
                        <Insignia r={r} tam={48} />
                        <div className="min-w-0 flex-1">
                            <ChipEstado r={r} />
                            <p className="mt-1.5 text-[14px] font-semibold leading-snug">{!conPosicion ? "Sin satélites todavía" : r.direccion || <span className="tabular-nums">{r.lat!.toFixed(5)}, {r.lon!.toFixed(5)}</span>}</p>
                            {conPosicion && <p className="text-[12px] text-muted-foreground">Posición de {hace(r.cuando)}{quedoAhi(r) ? " · quieto, el GPS se duerme: es donde quedó" : ""}</p>}
                        </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-[10px] border border-border bg-card/40 p-3.5 sm:grid-cols-3">
                        <Dato k="Reportó">{hace(r.ultimoLatido, "nunca")}</Dato>
                        <Dato k="Motor" tono={r.encendido ? "tono-bien" : undefined}>{r.encendido === null ? "—" : r.encendido ? "Encendido" : "Apagado"}</Dato>
                        <Dato k="Velocidad">{r.velocidad ?? 0} km/h</Dato>
                        <Dato k="Batería del vehículo" tono={r.voltaje !== null && r.voltaje < VOLTAJE_BAJO ? "tono-aviso" : undefined}>{r.voltaje === null ? "—" : voltios(r.voltaje)}</Dato>
                        <Dato k="Señal">{r.senal === null ? "—" : SENAL[Math.min(4, r.senal)]}</Dato>
                        <Dato k="Corte de motor" tono={r.cortado ? "tono-mal" : undefined}>{r.cortado === null ? "Sin dato" : r.cortado ? "Cortado" : "En reposo"}</Dato>
                    </div>
                </section>

                {/* ── Adónde ir con este vehículo ── */}
                {r.deviceId && (
                    <section>
                        <p className={ROTULO}>Ir a</p>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                            {conPosicion && <Link href={`/admin/mapa?gps=${r.imei}`} className={ACCION}><MapPin size={17} className="text-[var(--accion)]" /> Mapa y recorrido</Link>}
                            <Link href={`/admin/mapa?gps=${r.imei}&eventos=1`} className={ACCION}><History size={17} className="text-[var(--accion)]" /> Sus eventos</Link>
                            <button type="button" onClick={() => alIr("reportes")} className={ACCION}><FileSpreadsheet size={17} className="text-[var(--accion)]" /> Reportes</button>
                            <button type="button" onClick={() => alIr("comandos")} className={ACCION}>{r.cortado ? <Radio size={17} className="tono-mal" /> : <TerminalSquare size={17} className="text-[var(--accion)]" />} Comandos</button>
                            {puede("compartir") && <button type="button" onClick={() => setCompartiendo(true)} className={cn(ACCION, "col-span-2")}><Share2 size={17} className="text-[var(--accion)]" /> Compartir dónde va, con un enlace</button>}
                        </div>
                    </section>
                )}
                {!r.deviceId && <p className="chip-aviso rounded-[10px] border px-3.5 py-3 text-[13px] leading-snug">Este rastreador se presentó en el receptor y todavía nadie lo aceptó. Se da de alta en <Link href="/admin/devices" className="font-semibold underline">Dispositivos › GPS</Link>; recién entonces aparece en el mapa y acepta comandos.</p>}

                {r.deviceId && puede("config") && <Datos key={r.imei} r={r} alCambiar={alCambiar} />}
            </div>
            {compartiendo && <CompartirGps imei={r.imei} nombre={nombreDe(r)} alCerrar={() => setCompartiendo(false)} />}
        </CajonContenido>
    );
}

/** Cómo se llama, qué vehículo del padrón es y con qué dibujo se lo ve. */
function Datos({ r, alCambiar }: { r: Rastreador; alCambiar: () => void }) {
    const [nombre, setNombre] = useState(r.nombre || "");
    const [chapa, setChapa] = useState(r.matricula || "");
    const [icono, setIcono] = useState(r.icono || "auto");
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    /* Si otro lo cambió mientras la ficha estaba abierta y acá no se tocó nada, se muestra lo nuevo. */
    useEffect(() => { setIcono(r.icono || "auto"); }, [r.icono]);
    const cambio = nombre.trim() !== (r.nombre || "") || chapa.trim().toUpperCase() !== (r.matricula || "");

    const guardar = async () => {
        setGuardando(true); setError(null);
        try {
            if (nombre.trim() !== (r.nombre || "")) { const x = await renombrarGps(r.imei, nombre); if (!x.ok) { setError(x.error || "No se pudo cambiar el nombre."); return; } }
            if (chapa.trim().toUpperCase() !== (r.matricula || "")) { const x = await atarVehiculoGps(r.imei, chapa.trim().toUpperCase()); if (!x.ok) { setError(x.error || "No se pudo atar a ese vehículo."); return; } }
            toast.success({ title: "Guardado" }); alCambiar();
        } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar."); }
        finally { setGuardando(false); }
    };
    const elegirIcono = async (clave: string) => {
        const antes = icono; setIcono(clave);
        try { const x = await cambiarIconoGps(r.imei, clave); if (!x.ok) { setIcono(antes); setError(x.error || "No se pudo cambiar el dibujo."); } else alCambiar(); }
        catch { setIcono(antes); setError("No se pudo cambiar el dibujo."); }
    };
    return (
        <section>
            <p className={ROTULO}>Datos</p>
            <div className="mt-2 space-y-3">
                <label className="block">
                    <span className="mb-1.5 block text-[12.5px] font-semibold">Nombre</span>
                    <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={60} placeholder="Ej. Camioneta 1" className={CAMPO} />
                </label>
                <label className="block">
                    <span className="mb-1.5 block text-[12.5px] font-semibold">Matrícula del vehículo</span>
                    <input value={chapa} onChange={(e) => setChapa(e.target.value.toUpperCase())} maxLength={12} autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder="La de un vehículo del padrón" className={cn(CAMPO, "tabular-nums")} />
                    <span className="mt-1.5 block text-[11.5px] leading-snug text-muted-foreground">Atarlo a su matrícula es lo que permite cruzar lo que dice el GPS con lo que leen las cámaras. Vacía, lo desata.</span>
                </label>
                {error && <p className="tono-mal text-[12.5px] font-semibold" role="alert">{error}</p>}
                {cambio && <Button onClick={guardar} disabled={guardando} className="h-11 w-full text-[14px] sm:h-9 sm:w-auto sm:text-[13px]">{guardando && <Loader2 size={15} className="animate-spin" />} Guardar</Button>}
                <div>
                    <p className="mb-1.5 text-[12.5px] font-semibold">Cómo se ve en el mapa</p>
                    <Tira label="Dibujo en el mapa">
                        {ICONOS_GPS.map((i) => <button key={i.clave} type="button" aria-pressed={icono === i.clave} onClick={() => elegirIcono(i.clave)} className={pildora(icono === i.clave)}>{i.rotulo}</button>)}
                    </Tira>
                </div>
            </div>
        </section>
    );
}
