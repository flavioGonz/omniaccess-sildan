"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, SkipForward, RefreshCw, TriangleAlert, Trash2, Target, Loader2, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Miniatura, Momento, Estado } from "@/components/ui/celdas";
import {
    siguienteCaptura, guardarValidacion, borrarValidacion, listarValidaciones, resumenValidacion, filasParaValidar,
    type CapturaAValidar, type Validacion, type ResumenValidacion,
} from "@/app/actions/validacion-filas";
import { horaSeg, fechaCorta } from "@/lib/fechas";
import { cn } from "@/lib/utils";

/**
 * Validar el conteo (HB, 20/10). Una persona mira una captura, cuenta la gente y escribe el
 * número; recién ahí se ve lo que dijo la cámara. Con unas decenas de respuestas queda la
 * precisión documentada del contador: exactas, dentro de ±1, error medio y hacia qué lado se
 * equivoca. Sin ese número ningún otro dato de filas (espera, avisos, reportes) se puede vender.
 *
 * Pensado para hacerse rápido y sin mouse: dígitos, Enter para confirmar, S para saltar.
 */

/** Botones de números a la vista. Más gente se escribe con el teclado. */
const BOTONES = Array.from({ length: 13 }, (_, i) => i);
/** Cuánto queda a la vista «la cámara dijo N» antes de pasar a la siguiente. */
const REVELACION_MS = 1_600;

type Revelado = { camara: number; humano: number };

const tonoDif = (d: number) => (d === 0 ? "bien" : Math.abs(d) === 1 ? "aviso" : "mal") as "bien" | "aviso" | "mal";
const pct = (x: number) => `${Math.round(x * 100)}%`;
const personas = (n: number) => `${String(n).replace(".", ",")} ${Math.abs(n) === 1 ? "persona" : "personas"}`;

export default function ValidarConteoPage() {
    const [filas, setFilas] = useState<{ id: string; name: string }[]>([]);
    const [deviceId, setDeviceId] = useState("");
    const [captura, setCaptura] = useState<CapturaAValidar | null>(null);
    const [sinMas, setSinMas] = useState(false);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [escrito, setEscrito] = useState("");
    const [revelado, setRevelado] = useState<Revelado | null>(null);
    const [guardando, setGuardando] = useState(false);
    const [resumen, setResumen] = useState<ResumenValidacion | null>(null);
    const [lista, setLista] = useState<Validacion[]>([]);
    const [errorLista, setErrorLista] = useState<string | null>(null);
    const saltadas = useRef<string[]>([]);

    useEffect(() => { filasParaValidar().then(setFilas).catch(() => {}); }, []);

    const traerSiguiente = useCallback(async () => {
        setCargando(true); setRevelado(null); setEscrito("");
        try {
            const c = await siguienteCaptura({ deviceId: deviceId || null, excluir: saltadas.current });
            setCaptura(c); setSinMas(!c); setError(null);
        } catch (e: any) { setError(e?.message || "No se pudo traer una captura"); }
        finally { setCargando(false); }
    }, [deviceId]);

    const traerResultados = useCallback(async () => {
        try {
            const [r, l] = await Promise.all([resumenValidacion({ deviceId: deviceId || null }), listarValidaciones({ deviceId: deviceId || null })]);
            setResumen(r); setLista(l); setErrorLista(null);
        } catch (e: any) { setErrorLista(e?.message || "No se pudieron leer las validaciones"); }
    }, [deviceId]);

    useEffect(() => { saltadas.current = []; traerSiguiente(); traerResultados(); }, [traerSiguiente, traerResultados]);

    const confirmar = useCallback(async (valor?: number) => {
        if (!captura || guardando || revelado) return;
        const humano = valor ?? (escrito === "" ? NaN : Number(escrito));
        if (!Number.isFinite(humano)) return;
        setGuardando(true);
        try {
            const r = await guardarValidacion({ eventId: captura.eventId, humano });
            setRevelado({ camara: r.camara, humano: r.humano });
            traerResultados();
            setTimeout(() => traerSiguiente(), REVELACION_MS);
        } catch (e: any) { setError(e?.message || "No se pudo guardar"); }
        finally { setGuardando(false); }
    }, [captura, guardando, revelado, escrito, traerResultados, traerSiguiente]);

    const saltar = useCallback(() => {
        if (!captura || revelado) return;
        saltadas.current.push(captura.eventId);
        traerSiguiente();
    }, [captura, revelado, traerSiguiente]);

    // Teclado: dígitos arman el número, Enter confirma, S salta, Backspace borra.
    useEffect(() => {
        const alTeclear = (ev: KeyboardEvent) => {
            const t = ev.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
            if (/^[0-9]$/.test(ev.key)) {
                ev.preventDefault();
                // Los dígitos se acumulan («1», «2» → 12) hasta Enter: así entra cualquier cantidad.
                setEscrito((v) => (v.length >= 3 ? v : v + ev.key));
            } else if (ev.key === "Enter") { ev.preventDefault(); confirmar(); }
            else if (ev.key === "Backspace") { setEscrito((v) => v.slice(0, -1)); }
            else if (ev.key.toLowerCase() === "s") { ev.preventDefault(); saltar(); }
        };
        window.addEventListener("keydown", alTeclear);
        return () => window.removeEventListener("keydown", alTeclear);
    }, [confirmar, saltar]);

    const borrar = async (v: Validacion) => {
        try { await borrarValidacion(v.id); traerResultados(); } catch (e: any) { setErrorLista(e?.message || "No se pudo borrar"); }
    };

    const columnas: ColumnaTabla<Validacion>[] = useMemo(() => [
        { clave: "foto", titulo: "Foto", ancho: 100, auxiliar: true,
            celda: (v) => v.foto ? <a href={v.foto} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><Miniatura src={v.foto} /></a> : <Miniatura src={null} /> },
        { clave: "momento", titulo: "Captura", ancho: 130, valor: (v) => v.momento, celda: (v) => <Momento t={v.momento} /> },
        ...(filas.length > 1 ? [{ clave: "fila", titulo: "Fila", valor: (v: Validacion) => v.fila } as ColumnaTabla<Validacion>] : []),
        { clave: "camara", titulo: "Cámara", ancho: 90, alinear: "der", valor: (v) => v.camara, celda: (v) => <span className="tabular-nums font-semibold">{v.camara}</span> },
        { clave: "humano", titulo: "Persona", ancho: 90, alinear: "der", valor: (v) => v.humano, celda: (v) => <span className="tabular-nums font-semibold">{v.humano}</span> },
        { clave: "dif", titulo: "Diferencia", ancho: 120, valor: (v) => v.camara - v.humano,
            celda: (v) => { const d = v.camara - v.humano; return <Estado tono={tonoDif(d)}>{d === 0 ? "Exacta" : `${d > 0 ? "+" : ""}${d}`}</Estado>; } },
        { clave: "usuario", titulo: "Validó", ancho: 140, valor: (v) => v.usuario || "" },
        { clave: "creada", titulo: "Cuándo", ancho: 120, valor: (v) => v.creada, celda: (v) => <span className="text-[12px] text-muted-foreground tabular-nums">{fechaCorta(v.creada)} {horaSeg(v.creada)}</span> },
        { clave: "acc", titulo: "", ancho: 50, auxiliar: true,
            celda: (v) => <Button variant="ghost" size="icon-sm" title="Borrar esta validación" onClick={(e) => { e.stopPropagation(); borrar(v); }}><Trash2 size={14} /></Button> },
    ], [filas.length]); // eslint-disable-line react-hooks/exhaustive-deps

    const dif = revelado ? revelado.camara - revelado.humano : 0;

    return (
        <div className="p-6 space-y-5 max-w-[1680px] mx-auto">
            <div className="flex flex-wrap items-end gap-3">
                <div className="mr-auto">
                    <h1 className="text-[28px] font-bold tracking-[-0.02em] leading-tight">Validar el conteo</h1>
                    <p className="text-[13px] text-muted-foreground">Contá la gente de cada captura. Lo que dijo la cámara aparece después de contestar, para no influir.</p>
                </div>
                {filas.length > 1 && (
                    <div className="inline-flex items-center gap-0.5 rounded-full border border-border bg-card p-0.5">
                        {[{ id: "", name: "Todas" }, ...filas].map((f) => (
                            <button key={f.id || "todas"} type="button" onClick={() => setDeviceId(f.id)}
                                className={cn("rounded-full px-3 py-1 text-[12px] font-semibold transition-colors",
                                    deviceId === f.id ? "accion" : "text-muted-foreground hover:text-foreground")}>{f.name}</button>
                        ))}
                    </div>
                )}
                <Button variant="ghost" size="sm" onClick={() => { traerSiguiente(); traerResultados(); }} title="Actualizar"><RefreshCw size={14} /></Button>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-5">
                {/* La captura y los números. */}
                <div className="space-y-3 min-w-0">
                    <div className="relative aspect-video rounded-[10px] overflow-hidden bg-black sombra-captura">
                        {captura && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={captura.eventId} src={captura.foto} alt="Captura a contar" className="absolute inset-0 w-full h-full object-contain" />
                        )}
                        {cargando && !captura && <div className="absolute inset-0 grid place-items-center text-white/70"><Loader2 size={20} className="animate-spin" /></div>}
                        {!cargando && sinMas && (
                            <div className="absolute inset-0 grid place-items-center text-center text-white/80 px-6">
                                <span className="flex flex-col items-center gap-2 text-[13px]"><ImageOff size={22} /> No quedan capturas sin validar{deviceId ? " de esta fila" : ""}.</span>
                            </div>
                        )}
                        {error && (
                            <div className="absolute inset-0 grid place-items-center bg-black/70 text-white text-[13px]">
                                <span className="flex flex-col items-center gap-3"><TriangleAlert size={18} /> {error}
                                    <Button size="sm" variant="outline" onClick={traerSiguiente}>Reintentar</Button></span>
                            </div>
                        )}
                        {captura && (
                            <div className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11.5px] text-white tabular-nums">
                                {captura.fila} · {fechaCorta(captura.momento)} {horaSeg(captura.momento)}
                            </div>
                        )}
                        {/* La revelación: recién ahora se ve lo que dijo la cámara. */}
                        {revelado && (
                            <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/85 to-transparent flex items-end justify-between gap-3">
                                <div className="text-white">
                                    <div className="text-[12px] text-white/70">Vos contaste <b className="text-white">{revelado.humano}</b></div>
                                    <div className="text-[20px] font-bold leading-tight">La cámara dijo {revelado.camara}</div>
                                </div>
                                <span className={cn("text-[13px] font-bold px-3 py-1 rounded-full border", `chip-${tonoDif(dif)}`)}>
                                    {dif === 0 ? "Exacta" : `${dif > 0 ? "Contó de más" : "Contó de menos"} (${dif > 0 ? "+" : ""}${dif})`}
                                </span>
                            </div>
                        )}
                    </div>

                    <div className="rounded-[14px] border border-border bg-card p-4 space-y-3">
                        <div className="flex items-center gap-3">
                            <span className="text-[13px] font-semibold">¿Cuántas personas hay en la zona de la fila?</span>
                            <span className="ml-auto text-[12px] text-muted-foreground">Teclado: números, <kbd className="px-1 rounded border border-border">Enter</kbd> confirma, <kbd className="px-1 rounded border border-border">S</kbd> salta</span>
                        </div>
                        <div className="grid grid-cols-7 sm:grid-cols-[repeat(13,minmax(0,1fr))] gap-2">
                            {BOTONES.map((n) => (
                                <button key={n} type="button" disabled={!captura || !!revelado || guardando} onClick={() => confirmar(n)}
                                    className={cn("h-12 rounded-[10px] border text-[18px] font-bold tabular-nums transition-colors disabled:opacity-40",
                                        escrito === String(n) ? "accion border-transparent" : "border-border bg-background hover:border-[var(--accion)] hover:text-[var(--accion)]")}>
                                    {n}
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[12.5px] text-muted-foreground">Más gente:</span>
                            <input inputMode="numeric" value={escrito} onChange={(e) => setEscrito(e.target.value.replace(/\D/g, "").slice(0, 3))}
                                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmar(); } }}
                                placeholder="13" className="h-9 w-20 rounded-md border border-border bg-background px-2 text-[15px] font-semibold tabular-nums" aria-label="Cantidad de personas" />
                            <Button size="sm" onClick={() => confirmar()} disabled={!captura || !!revelado || guardando || escrito === ""} className="gap-1.5">
                                {guardando ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Confirmar
                            </Button>
                            <Button size="sm" variant="ghost" onClick={saltar} disabled={!captura || !!revelado} className="gap-1.5 ml-auto">
                                <SkipForward size={14} /> No se ve bien, saltar
                            </Button>
                        </div>
                        {captura && <p className="text-[11.5px] text-muted-foreground">Quedan {captura.quedan.toLocaleString("es-UY")} capturas sin validar. Se sortean de modo que no salgan todas de una persona: también hacen falta los momentos con la fila cargada.</p>}
                    </div>
                </div>

                {/* El resultado hasta ahora. */}
                <ResumenPanel r={resumen} />
            </div>

            <section className="space-y-2">
                <div className="flex items-baseline gap-3">
                    <h2 className="text-[17px] font-bold tracking-[-0.01em]">Validaciones</h2>
                    <span className="text-[12px] text-muted-foreground tabular-nums">{lista.length}</span>
                </div>
                <Tabla<Validacion> id="validaciones-conteo" filas={lista} clave={(v) => v.id} columnas={columnas}
                    cargando={!resumen && !errorLista} error={errorLista} alReintentar={traerResultados} filasFantasma={3} nombreArchivo="validacion-conteo"
                    vacio={{ icono: Target, titulo: "Todavía no hay validaciones", ayuda: "Contá unas 50 capturas para tener una precisión que se pueda mostrar." }} />
            </section>
        </div>
    );
}

/** Mínimo de validaciones para dar un veredicto: con menos, el número cambia con cada respuesta. */
const MINIMO_VEREDICTO = 30;

function ResumenPanel({ r }: { r: ResumenValidacion | null }) {
    if (!r) return <div className="rounded-[14px] border border-border bg-card p-5 h-fit"><div className="h-40 rounded bg-muted animate-pulse" /></div>;
    const veredicto = (() => {
        if (!r.n) return "Todavía no hay respuestas.";
        const lado = Math.abs(r.sesgo) < 0.05 ? "sin inclinarse para ningún lado"
            : `en promedio la cámara cuenta ${personas(Math.abs(r.sesgo))} de ${r.sesgo > 0 ? "más" : "menos"}`;
        return `Acierta exacto ${pct(r.exactas)} de las veces y por una persona ${pct(r.dentroDeUno)}; ${lado}.`;
    })();
    const tonoExactas = r.exactas >= 0.9 ? "bien" : r.exactas >= 0.75 ? "aviso" : "mal";
    return (
        <div className="rounded-[14px] border border-border bg-card p-5 space-y-4 h-fit">
            <div className="flex items-center gap-2">
                <Target size={15} className="text-muted-foreground" />
                <span className="text-[13px] font-semibold">Precisión medida</span>
                <span className="ml-auto text-[12px] text-muted-foreground tabular-nums">{r.n} validaciones</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <Cifra rotulo="Exactas" valor={r.n ? pct(r.exactas) : "—"} tono={r.n >= MINIMO_VEREDICTO ? tonoExactas : undefined} />
                <Cifra rotulo="Dentro de ±1" valor={r.n ? pct(r.dentroDeUno) : "—"} />
                <Cifra rotulo="Error medio" valor={r.n ? String(r.errorMedio).replace(".", ",") : "—"} pie="personas" />
                <Cifra rotulo="Sesgo" valor={r.n ? `${r.sesgo > 0 ? "+" : ""}${String(r.sesgo).replace(".", ",")}` : "—"} pie={r.sesgo > 0 ? "cuenta de más" : r.sesgo < 0 ? "cuenta de menos" : ""} />
            </div>
            <p className="text-[13px] leading-relaxed">{veredicto}</p>
            {r.n > 0 && r.n < MINIMO_VEREDICTO && <p className="text-[12px] text-muted-foreground">Con menos de {MINIMO_VEREDICTO} respuestas el resultado todavía se mueve mucho.</p>}
            {r.mape != null && <p className="text-[12px] text-muted-foreground">Error relativo medio (con gente en la fila): {pct(r.mape)}.</p>}

            {r.confusion.length > 0 && <Confusion r={r} />}

            {r.porHora.length > 1 && (
                <div className="space-y-1.5">
                    <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Por hora</div>
                    <div className="space-y-1">
                        {r.porHora.map((h) => (
                            <div key={h.hora} className="flex items-center gap-2 text-[12px] tabular-nums">
                                <span className="w-10 text-muted-foreground">{String(h.hora).padStart(2, "0")} h</span>
                                <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                                    <div className={cn("h-full rounded-full", `pleno-${h.exactas >= 0.9 ? "bien" : h.exactas >= 0.75 ? "aviso" : "mal"}`)} style={{ width: `${Math.round(h.exactas * 100)}%` }} />
                                </div>
                                <span className="w-10 text-right">{pct(h.exactas)}</span>
                                <span className="w-8 text-right text-muted-foreground">{h.n}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function Cifra({ rotulo, valor, pie, tono }: { rotulo: string; valor: string; pie?: string; tono?: "bien" | "aviso" | "mal" }) {
    return (
        <div className="rounded-[10px] border border-border px-3 py-2.5">
            <div className="text-[11.5px] text-muted-foreground">{rotulo}</div>
            <div className="flex items-baseline gap-1.5">
                <span className={cn("text-[22px] font-bold tabular-nums leading-tight", tono && `tono-${tono}`)}>{valor}</span>
                {pie && <span className="text-[11px] text-muted-foreground">{pie}</span>}
            </div>
        </div>
    );
}

/** Cámara contra persona: la diagonal son los aciertos; arriba de ella, la cámara contó de más. */
function Confusion({ r }: { r: ResumenValidacion }) {
    const valores = [...new Set(r.confusion.flatMap((c) => [c.camara, c.humano]))].sort((a, b) => a - b);
    if (valores.length > 10) return null; // con tantos valores la grilla no se lee: alcanza con las cifras
    const celda = (cam: number, hum: number) => r.confusion.find((c) => c.camara === cam && c.humano === hum)?.n || 0;
    const max = Math.max(1, ...r.confusion.map((c) => c.n));
    return (
        <div className="space-y-1.5">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Cámara contra persona</div>
            <div className="overflow-x-auto">
                <table className="text-[11.5px] tabular-nums">
                    <thead>
                        <tr><th className="px-1.5 py-1 text-left font-normal text-muted-foreground">cám. ↓ / pers. →</th>
                            {valores.map((v) => <th key={v} className="px-1.5 py-1 font-semibold">{v}</th>)}</tr>
                    </thead>
                    <tbody>
                        {valores.map((cam) => (
                            <tr key={cam}>
                                <th className="px-1.5 py-1 text-left font-semibold">{cam}</th>
                                {valores.map((hum) => {
                                    const n = celda(cam, hum);
                                    return (
                                        <td key={hum} className="p-0.5">
                                            <div className={cn("h-7 w-8 rounded-[6px] grid place-items-center", n === 0 ? "text-muted-foreground/40" : cam === hum ? "chip-bien border" : "chip-mal border")}
                                                style={n ? { opacity: 0.45 + 0.55 * (n / max) } : undefined}>{n || "·"}</div>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
