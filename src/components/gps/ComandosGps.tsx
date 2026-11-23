"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, History, Loader2, Lock, MapPin, Radio, Satellite, TriangleAlert } from "lucide-react";
import { historialComandosGps, mandarComandoGps, valoresActualesGps, type ComandoMandado, type Rastreador, type RespuestaComando } from "@/app/actions/gps";
import { Button } from "@/components/ui/button";
import { ErrorEstado, Vacio } from "@/components/ui/estados";
import { armarComando, comandosDe, GRUPOS_COMANDO, leerEstadoDelEquipo, palabraDeConfirmacion, valoresPorDefecto, type CampoComando, type DefComando, type NivelComando, type Valores } from "@/lib/gps-comandos";
import type { QueGps } from "@/lib/gps-permisos";
import { hace } from "@/lib/fechas";
import { cn } from "@/lib/utils";
import { CAMPO, ChipEstado, nombreDe, Panel, pildora, ROTULO } from "@/components/gps/piezas";

/**
 * Los comandos al rastreador, todos (23/11).
 *
 * Pedido de Nico: «debemos poder integrar todos los comandos disponibles de este GPS». Había tres
 * en el menú del mapa: preguntar el estado, pedir la posición y el relé.
 *
 * Lo que se cuidó:
 *  · **Se ve lo que contestó el equipo, textual.** No se traduce: es un clon sin manual, y la única
 *    prueba de que entendió un comando es lo que dijo.
 *  · **Un formulario arranca con lo que el equipo tiene hoy**, no con valores de fábrica: al abrirlo
 *    se le pregunta. Mandar «el intervalo de fábrica» sin querer es cambiarle la configuración a un
 *    vehículo que estaba bien.
 *  · **Después de cambiar algo se le vuelve a preguntar cómo quedó**, y se muestran las dos cosas.
 *  · **Lo que no tiene vuelta se confirma en serio**: cortar el motor, con un segundo toque (y el
 *    servidor lo rechaza si el vehículo anda); cambiarle el servidor o volverlo de fábrica,
 *    escribiendo el final del IMEI.
 *  · **Lo que el rol no puede mandar se ve igual, apagado y diciendo por qué.** Que exista y quién
 *    lo puede hacer es información; un botón que desaparece no enseña nada.
 */

/** Qué permiso pide cada clase de comando: lo mismo que exige el servidor (actions/gps, PERMISO_DE_NIVEL). */
const PERMISO: Record<NivelComando, QueGps> = { consulta: "operar", ajuste: "config", rele: "rele", instalacion: "equipo" };
const QUIEN_PUEDE: Record<NivelComando, string> = {
    consulta: "Tu rol puede ver la flota, pero no preguntarle al equipo.",
    ajuste: "Lo cambia quien tiene «Configurar el rastreo».",
    rele: "Lo acciona quien tiene «Cortar y devolver el motor».",
    instalacion: "Lo cambia quien instala los equipos («Editar dispositivos»).",
};

export function ComandosGps({ lista, imei, alElegir, puede, alCambiar }: {
    lista: Rastreador[];
    imei: string | null;
    alElegir: (imei: string) => void;
    puede: (que: QueGps) => boolean;
    /** Algo cambió en el equipo (el relé): que la lista se vuelva a pedir. */
    alCambiar: () => void;
}) {
    const deAlta = useMemo(() => lista.filter((r) => r.deviceId), [lista]);
    const r = deAlta.find((x) => x.imei === imei) || deAlta[0] || null;
    const comandos = useMemo(() => comandosDe(r?.protocolo), [r?.protocolo]);

    /* El historial: se vuelve a pedir después de cada comando. */
    const [historial, setHistorial] = useState<{ de: string; filas: ComandoMandado[] | null; error: string | null }>({ de: "", filas: null, error: null });
    const [vuelta, setVuelta] = useState(0);
    const elImei = r?.imei || "";
    useEffect(() => {
        if (!elImei) return;
        let vivo = true;
        historialComandosGps(elImei, 20)
            .then((filas) => { if (vivo) setHistorial({ de: elImei, filas, error: null }); })
            .catch((e) => { if (vivo) setHistorial({ de: elImei, filas: null, error: e instanceof Error ? e.message : "No se pudo traer." }); });
        return () => { vivo = false; };
    }, [elImei, vuelta]);
    const hecho = useCallback((def: DefComando) => { setVuelta((n) => n + 1); if (def.grupo === "rele") alCambiar(); }, [alCambiar]);

    /* Un solo comando abierto a la vez: en el celular, dos formularios abiertos son una pantalla de scroll. */
    /* Se guarda de qué vehículo es: al cambiar de vehículo, lo abierto deja de valer solo, sin un efecto que lo cierre. */
    const [abiertoEn, setAbiertoEn] = useState<{ imei: string; clave: string } | null>(null);
    const abierto = abiertoEn?.imei === elImei ? abiertoEn.clave : null;

    if (!deAlta.length) return <Vacio icono={Satellite} titulo="No hay rastreadores dados de alta" ayuda="Un rastreador acepta comandos recién cuando alguien lo dio de alta, en Dispositivos › GPS." />;
    if (!r) return null;

    return (
        <div className="mx-auto max-w-3xl space-y-4">
            {/* ── A cuál ── */}
            <Panel className="p-4">
                <label className="block">
                    <span className={ROTULO}>Vehículo</span>
                    {/* Un desplegable del sistema y no uno dibujado: en el celular abre la rueda nativa, que es lo que mejor se usa con el pulgar. */}
                    <select value={r.imei} onChange={(e) => alElegir(e.target.value)} className={cn(CAMPO, "mt-1.5 font-semibold")} aria-label="Vehículo al que se le manda el comando">
                        {deAlta.map((x) => <option key={x.imei} value={x.imei}>{nombreDe(x)}{x.matricula && x.nombre ? ` · ${x.matricula}` : ""}</option>)}
                    </select>
                </label>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-muted-foreground">
                    <ChipEstado r={r} />
                    <span>Reportó {hace(r.ultimoLatido, "nunca")}</span>
                    <span className="tabular-nums">IMEI {r.imei}</span>
                </div>
                {!r.enLinea && (
                    <p className="chip-aviso mt-3 flex items-start gap-2 rounded-[6px] border px-3 py-2 text-[12.5px] leading-snug">
                        <TriangleAlert size={15} className="mt-[1px] shrink-0" />
                        <span>No está en línea. Los comandos viajan por la conexión que el propio rastreador mantiene abierta: hasta que vuelva a reportar no se le puede mandar nada.</span>
                    </p>
                )}
            </Panel>

            {!comandos.length ? (
                <Panel><Vacio icono={Radio} titulo="A este modelo todavía no se le pueden mandar comandos" ayuda={`Habla ${r.protocolo}. Por ahora se lo configura por SMS o con el programa del fabricante.`} /></Panel>
            ) : GRUPOS_COMANDO.map((g) => {
                const suyos = comandos.filter((c) => c.grupo === g.clave);
                if (!suyos.length) return null;
                return (
                    <Panel key={g.clave}>
                        <header className="px-4 pb-2 pt-4">
                            <h3 className="text-[14px] font-bold">{g.titulo}</h3>
                            <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{g.ayuda}</p>
                        </header>
                        <ul className="divide-y divide-border border-t border-border">
                            {suyos.map((c) => (
                                <li key={c.clave}>
                                    <Comando def={c} r={r} permitido={puede(PERMISO[c.nivel])} abierto={abierto === c.clave}
                                        alAbrir={() => setAbiertoEn(abierto === c.clave ? null : { imei: r.imei, clave: c.clave })} alTerminar={() => hecho(c)} />
                                </li>
                            ))}
                        </ul>
                    </Panel>
                );
            })}

            {/* ── Lo que se le mandó ── */}
            <Panel>
                <header className="flex items-center gap-2 px-4 py-3">
                    <History size={15} className="text-muted-foreground" />
                    <h3 className="text-[14px] font-bold">Lo último que se le mandó</h3>
                </header>
                <div className="border-t border-border">
                    {historial.error && historial.de === elImei ? <ErrorEstado mensaje={historial.error} alReintentar={() => setVuelta((n) => n + 1)} />
                        : historial.de !== elImei || !historial.filas ? <p className="flex items-center gap-2 px-4 py-6 text-[12.5px] text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Trayendo el historial…</p>
                        : !historial.filas.length ? <Vacio className="py-8" icono={History} titulo="Todavía no se le mandó nada desde acá" ayuda="Cada comando queda anotado con quién lo mandó y lo que contestó el equipo." />
                        : (
                            <ul className="divide-y divide-border">
                                {historial.filas.map((h) => (
                                    <li key={h.id} className="px-4 py-3">
                                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                            <p className="text-[13px] font-semibold">{h.titulo}</p>
                                            <p className="text-[11.5px] text-muted-foreground">{h.quien} · {hace(h.cuando)}</p>
                                        </div>
                                        <p className="mt-0.5 break-all text-[12px] tabular-nums text-muted-foreground">{h.texto}</p>
                                        <p className={cn("mt-1 break-words text-[12.5px] leading-snug", !h.ok && "tono-mal")}>{h.ok ? `«${h.respuesta || "sin texto"}»` : h.respuesta || "No contestó."}</p>
                                        {h.quedo && <p className="mt-0.5 break-words text-[12px] leading-snug text-muted-foreground">Quedó: «{h.quedo}»</p>}
                                    </li>
                                ))}
                            </ul>
                        )}
                </div>
            </Panel>
        </div>
    );
}

/** Un comando: su renglón y, abierto, su formulario y lo que contestó el equipo. */
function Comando({ def, r, permitido, abierto, alAbrir, alTerminar }: {
    def: DefComando; r: Rastreador; permitido: boolean; abierto: boolean; alAbrir: () => void; alTerminar: () => void;
}) {
    const sinCampos = !def.campos?.length;
    return (
        <div>
            <button type="button" onClick={alAbrir} aria-expanded={abierto}
                className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/60">
                <span className="min-w-0 flex-1">
                    <span className={cn("block text-[13.5px] font-semibold leading-tight", def.clave === "rele.accionar" && "tono-mal")}>{def.titulo}</span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">{def.ayuda}</span>
                </span>
                {!permitido && <Lock size={14} className="shrink-0 text-muted-foreground" aria-label="Tu rol no puede mandarlo" />}
                <ChevronDown size={16} className={cn("shrink-0 text-muted-foreground transition-transform", abierto && "rotate-180")} />
            </button>
            {/* Se monta recién al abrirse: es cuando le pregunta al equipo cómo está hoy. */}
            {abierto && (
                <div className="border-t border-border bg-muted/30 px-4 py-4">
                    {!permitido ? <p className="flex items-start gap-2 text-[12.5px] leading-snug text-muted-foreground"><Lock size={14} className="mt-[2px] shrink-0" />{QUIEN_PUEDE[def.nivel]}</p>
                        : <Formulario key={`${r.imei}:${def.clave}`} def={def} r={r} sinCampos={sinCampos} alTerminar={alTerminar} />}
                </div>
            )}
        </div>
    );
}

function Formulario({ def, r, sinCampos, alTerminar }: { def: DefComando; r: Rastreador; sinCampos: boolean; alTerminar: () => void }) {
    const [valores, setValores] = useState<Valores>(() => valoresPorDefecto(def));
    /* Cómo está hoy: `null` mientras se pregunta. Los comandos sin campos no preguntan nada al abrirse. */
    /* Los que informan su configuración en cada posición (`deAjustes`) no necesitan estar en línea: se lee lo último que dijeron. */
    const preguntaAlAbrir = !sinCampos && ((!!def.pregunta && r.enLinea) || !!def.deAjustes);
    const [hoy, setHoy] = useState<{ respuesta?: string; leido: boolean; error?: string } | null>(preguntaAlAbrir ? null : { leido: false });
    useEffect(() => {
        if (!preguntaAlAbrir) return;
        let vivo = true;
        valoresActualesGps(r.imei, def.clave)
            .then((x) => {
                if (!vivo) return;
                if (x.ok && x.valores) setValores((v) => ({ ...v, ...x.valores }));
                setHoy({ respuesta: x.respuesta, leido: !!(x.ok && x.valores), error: x.ok ? undefined : x.error });
            })
            .catch((e) => { if (vivo) setHoy({ leido: false, error: e instanceof Error ? e.message : "No se pudo preguntar." }); });
        return () => { vivo = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- se pregunta una vez, al abrir
    }, []);

    const armado = useMemo(() => armarComando(def, valores), [def, valores]);
    const [mandando, setMandando] = useState(false);
    const [armadoParaMandar, setArmadoParaMandar] = useState(false);
    const [tipeado, setTipeado] = useState("");
    const [resultado, setResultado] = useState<RespuestaComando | null>(null);
    useEffect(() => { if (!armadoParaMandar) return; const t = setTimeout(() => setArmadoParaMandar(false), 6000); return () => clearTimeout(t); }, [armadoParaMandar]);

    const palabra = palabraDeConfirmacion(r.imei);
    const faltaEscribir = def.confirmar === "escribir" && tipeado.trim() !== palabra;
    const mandar = async () => {
        /* El primer toque arma; el segundo, dentro de unos segundos, manda. Un toque que iba para el renglón de al lado no corta un motor. */
        if (def.confirmar === "toque" && !armadoParaMandar) { setArmadoParaMandar(true); return; }
        setMandando(true); setArmadoParaMandar(false); setResultado(null);
        try {
            const x = await mandarComandoGps(r.imei, def.clave, valores, def.confirmar === "escribir" ? tipeado.trim() : null);
            setResultado(x); setTipeado("");
        } catch (e) { setResultado({ ok: false, error: e instanceof Error ? e.message : "No se pudo mandar." }); }
        finally { setMandando(false); alTerminar(); }
    };

    const apagada = valores.on === "OFF";
    const esCorte = def.clave === "rele.accionar";
    const boton = def.nivel === "consulta" ? "Preguntarle" : esCorte ? "Cortar el motor" : def.clave === "rele.soltar" ? "Devolver el motor" : sinCampos ? def.titulo : "Mandar al equipo";

    return (
        <div className="space-y-3.5">
            {/* ── Cómo está hoy ── */}
            {hoy === null && <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Preguntándole al equipo cómo está hoy…</p>}
            {hoy?.respuesta && <p className="break-words text-[12px] leading-snug text-muted-foreground">Hoy el equipo dice: <span className="font-semibold text-foreground">«{hoy.respuesta}»</span>{!hoy.leido && " No se pudo leer en los campos: revisalos antes de mandar."}</p>}
            {hoy?.error && <p className="tono-aviso text-[12px] leading-snug">No se pudo saber cómo está hoy ({hoy.error.replace(/\.$/, "")}). Los campos arrancan con los valores de fábrica.</p>}

            {/* ── Los campos ── */}
            {!sinCampos && hoy !== null && (
                <div className="grid gap-3 sm:grid-cols-2">
                    {def.campos!.map((c) => (apagada && c.clave !== "on" ? null : <Campo key={c.clave} c={c} valor={valores[c.clave]} alCambiar={(v) => setValores((x) => ({ ...x, [c.clave]: v }))} />))}
                </div>
            )}

            {def.cuidado && <p className="tono-aviso flex items-start gap-2 text-[12px] leading-snug"><TriangleAlert size={14} className="mt-[2px] shrink-0" />{def.cuidado}</p>}

            {/* Lo que va a viajar, a la vista: es un equipo sin manual, y quien instala reconoce el comando por su texto. */}
            {!sinCampos && hoy !== null && (armado.ok
                ? <p className="break-all text-[12px] text-muted-foreground">Va a viajar: <span className="font-semibold tabular-nums text-foreground">{def.paraAnotar ? def.paraAnotar(armado.valores) : armado.texto}</span></p>
                : <p className="tono-mal text-[12.5px] font-semibold" role="alert">{armado.error}</p>)}

            {def.confirmar === "escribir" && (
                <label className="block">
                    <span className="block text-[12.5px] font-semibold leading-snug">Para confirmar, escribí los últimos cuatro números del IMEI: <span className="tabular-nums">{palabra}</span></span>
                    <input value={tipeado} onChange={(e) => setTipeado(e.target.value)} inputMode="numeric" autoComplete="off" maxLength={4} placeholder={palabra} className={cn(CAMPO, "mt-1.5 max-w-[160px] tabular-nums")} aria-label="Confirmación" />
                </label>
            )}

            <div className="flex flex-wrap items-center gap-2">
                <Button onClick={mandar} disabled={mandando || !r.enLinea || !armado.ok || faltaEscribir || hoy === null}
                    className={cn("h-11 w-full px-5 text-[14px] sm:h-9 sm:w-auto sm:text-[13px]", (esCorte || def.confirmar === "escribir" || (armadoParaMandar && def.nivel === "instalacion")) && "pleno-mal hover:opacity-90")}>
                    {mandando ? <Loader2 size={15} className="animate-spin" /> : null}
                    {mandando ? "Esperando al equipo…" : armadoParaMandar ? `¿Confirmar? ${boton}` : boton}
                </Button>
                {!r.enLinea && <p className="text-[12px] text-muted-foreground">El rastreador no está en línea.</p>}
            </div>

            {resultado && <Resultado def={def} x={resultado} />}
        </div>
    );
}

/** Un campo del formulario, según qué clase de dato lleva. */
function Campo({ c, valor, alCambiar }: { c: CampoComando; valor: string | number | undefined; alCambiar: (v: string) => void }) {
    const pocas = c.tipo === "opcion" && c.opciones.length <= 3;
    return (
        <div className={cn("min-w-0", (pocas || c.tipo === "texto") && "sm:col-span-2")}>
            {/* Con píldoras el rótulo es un título y no una etiqueta: no hay un campo al que atarla. */}
            {pocas ? <p className="mb-1.5 text-[12.5px] font-semibold">{c.rotulo}</p> : (
            <label className="block">
                <span className="mb-1.5 block text-[12.5px] font-semibold">{c.rotulo}</span>
                {c.tipo === "entero" ? (
                    <span className="flex items-center gap-2">
                        <input type="number" inputMode="numeric" min={c.min} max={c.max} value={valor ?? ""} onChange={(e) => alCambiar(e.target.value)} className={cn(CAMPO, "tabular-nums")} />
                        {c.unidad && <span className="w-10 shrink-0 text-[13px] text-muted-foreground">{c.unidad}</span>}
                    </span>
                ) : c.tipo === "opcion" && !pocas ? (
                    <select value={String(valor ?? c.defecto)} onChange={(e) => alCambiar(e.target.value)} className={CAMPO}>
                        {c.opciones.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
                    </select>
                ) : c.tipo === "telefono" ? (
                    <input type="tel" inputMode="tel" autoComplete="off" value={String(valor ?? "")} onChange={(e) => alCambiar(e.target.value)} placeholder="+598 9X XXX XXX" className={cn(CAMPO, "tabular-nums")} />
                ) : c.tipo === "texto" ? (
                    <input type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" maxLength={c.largo} value={String(valor ?? "")} onChange={(e) => alCambiar(e.target.value)} placeholder={c.ejemplo} className={CAMPO} />
                ) : null}
            </label>
            )}
            {/* Pocas opciones van a la vista, como píldoras: elegir entre dos cosas no merece abrir una lista. */}
            {pocas && c.tipo === "opcion" && (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={c.rotulo}>
                    {c.opciones.map((o) => <button key={o.valor} type="button" aria-pressed={String(valor ?? c.defecto) === o.valor} onClick={() => alCambiar(o.valor)} className={pildora(String(valor ?? c.defecto) === o.valor)}>{o.rotulo}</button>)}
                </div>
            )}
            {c.ayuda && <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">{c.ayuda}</p>}
            {c.tipo === "entero" && <p className="mt-1 text-[11px] text-muted-foreground">De {c.min.toLocaleString("es-UY")} a {c.max.toLocaleString("es-UY")}{c.unidad ? ` ${c.unidad}` : ""}.</p>}
        </div>
    );
}

/** Cómo dice la señal el equipo, en castellano. Lo que no esté acá se muestra como vino. */
const SENAL_DICHA: Record<string, string> = { strong: "Fuerte", good: "Buena", medium: "Media", normal: "Media", weak: "Débil", low: "Débil", "no signal": "Sin señal" };

/** Lo que contestó el equipo, textual, y cómo quedó. */
function Resultado({ def, x }: { def: DefComando; x: RespuestaComando }) {
    const estado = def.clave === "estado" && x.respuesta ? leerEstadoDelEquipo(x.respuesta) : null;
    /* «Dónde está» y «Enlace al mapa» traen una posición: se la ofrece como enlace, que es para lo que se la pidió. */
    const coord = x.respuesta ? /(-?\d{1,2}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})/.exec(x.respuesta) || /Lat:\s*([NS])(\d+\.\d+)\s*,\s*Lon:\s*([EW])(\d+\.\d+)/i.exec(x.respuesta) : null;
    const punto = !coord ? null : coord.length === 3 ? { lat: Number(coord[1]), lon: Number(coord[2]) } : { lat: (coord[1].toUpperCase() === "S" ? -1 : 1) * Number(coord[2]), lon: (coord[3].toUpperCase() === "W" ? -1 : 1) * Number(coord[4]) };
    const tono = !x.ok ? "chip-mal" : x.rechazo ? "chip-aviso" : "chip-bien";
    return (
        <div className={cn("rounded-[6px] border px-3 py-2.5", tono)} role="status" aria-live="polite">
            <p className="text-[12px] font-bold">{!x.ok ? "No se mandó o no contestó" : x.rechazo ? "El equipo contestó, y parece que no lo aceptó" : "El equipo contestó"}</p>
            <p className="mt-1 break-words text-[13px] leading-snug text-foreground">{x.ok ? `«${x.respuesta || "sin texto"}»` : x.error}</p>
            {x.quedo && <p className="mt-1.5 break-words text-[12.5px] leading-snug text-foreground">Y al preguntarle cómo quedó: <span className="font-semibold">«{x.quedo}»</span></p>}
            {x.ok && def.nivel !== "consulta" && def.pregunta && x.quedo === null && !def.puedeCallar && <p className="mt-1.5 text-[12px] leading-snug text-foreground">No contestó cuando se le preguntó cómo quedó. Volvé a abrir el comando para verlo.</p>}
            {estado && (
                <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px] text-foreground sm:grid-cols-3">
                    {([["Alimentación", estado.alimentacion ? estado.alimentacion.replace(".", ",").replace(/\s*V$/i, " V") : null], ["Enlace de datos", estado.enlace === null ? null : estado.enlace ? "Arriba" : "Caído"], ["Señal", estado.senal ? SENAL_DICHA[estado.senal.toLowerCase()] || estado.senal : null], ["GPS", estado.gps === null ? null : estado.gps ? "Despierto" : "Dormido"], ["Contacto", estado.contacto === null ? null : estado.contacto ? "Puesto" : "Cortado"], ["Guardia", estado.guardia === null ? null : estado.guardia ? "Puesta" : "Sin poner"]] as [string, string | null][])
                        .filter(([, v]) => v !== null).map(([k, v]) => <div key={k}><dt className="text-[11px] opacity-70">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
                </dl>
            )}
            {punto && Number.isFinite(punto.lat) && Number.isFinite(punto.lon) && (
                <a href={`https://maps.google.com/?q=${punto.lat},${punto.lon}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex h-10 items-center gap-1.5 text-[13px] font-semibold text-[var(--accion)] hover:underline sm:h-auto"><MapPin size={14} /> Abrir esa posición en el mapa</a>
            )}
        </div>
    );
}
