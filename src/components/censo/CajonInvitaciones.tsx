"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Clock, Download, Mail, Pause, Play, RefreshCw, Send, ShieldCheck, Timer, Trash2, Upload } from "lucide-react";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { sileo as toast } from "sileo";
import { Button } from "@/components/ui/button";
import { Cajon, CajonContenido, CajonSeccion } from "@/components/ui/cajon";
import { Chip, Cargando, ErrorEstado } from "@/components/ui/estados";
import { diaSemana, fechaHora, hora } from "@/lib/fechas";
import { RITMOS } from "@/lib/censo-goteo";
import type { EstadoGoteo } from "@/lib/censo-envio";
import type { JuicioDominio } from "@/lib/correo-dominio";
import { EditorCodigo } from "@/components/lotes/EditorCodigo";
import { cn } from "@/lib/utils";

/**
 * Las invitaciones del censo: un lote, su correo y su clave.
 *
 * Pedido de Nico (18/11, para San Nicolás): «clave individual por lote… se cargarán los correos
 * vía planilla, y enviará un correo individual a cada lote, con copia a la administración, así
 * queda la prueba de que se envió el registro».
 *
 * Tres cosas que esta pantalla hace a propósito:
 *  · **La clave no se vuelve a generar al reimportar la planilla.** Si ya salió el correo,
 *    cambiarla deja afuera a quien lo recibió; reimportar sólo corrige correos y nombres.
 *  · **Se manda de a 25.** Trescientos correos no entran en una petición y el servidor SMTP corta
 *    la conexión a la mitad; el botón sigue solo hasta que no quedan.
 *  · **El error del envío se guarda por fila.** «Se mandaron 280 de 300» sin decir cuáles
 *    fallaron obliga a adivinar; acá cada lote que falló dice por qué.
 *  · **Dice si los correos van a llegar a spam antes de mandarlos** (21/11). La invitación de
 *    prueba llegó a spam porque el dominio del remitente no autorizaba al servidor de salida: eso
 *    está escrito en el DNS y se puede leer antes de mandar 490.
 */

type Invitacion = {
    id: string; lote: string; email: string; nombre: string; clave: string;
    enviadoAt: string | null; usadoAt: string | null; intentos: number; error: string | null;
    /** Desde qué cuenta salió (25/11): la de la administración de sus lotes, o la general. */
    enviadoDesde?: string | null;
};
type Datos = { conClave: boolean; correoListo: boolean; copiaAdmin: string; dominio: JuicioDominio | null; invitaciones: Invitacion[]; goteo: EstadoGoteo };

/**
 * Si el dominio del remitente deja que este servidor mande en su nombre.
 *
 * Cuando está bien es un renglón; cuando no, ocupa lugar y trae lo que hay que cargar en el DNS,
 * listo para copiar: quien lo tiene que arreglar casi nunca es quien está mirando esta pantalla.
 */
function EstadoDelDominio({ j, mirando, alMirar }: { j: JuicioDominio; mirando: boolean; alMirar: () => void }) {
    const otraVez = (
        <button type="button" onClick={alMirar} disabled={mirando} className="inline-flex items-center gap-1 font-semibold text-[var(--accion)] hover:underline disabled:opacity-60">
            {mirando ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Volver a mirar
        </button>
    );
    if (j.estado === "bien") return (
        <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-muted-foreground"><ShieldCheck size={13} className="mt-0.5 shrink-0 tono-bien" />{j.titulo}</p>
    );
    if (j.estado === "no-se") return (
        <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground">{j.titulo} {otraVez}</p>
    );
    return (
        <div className={cn("mt-2.5 rounded-[10px] p-3 text-[12.5px] leading-snug", j.estado === "mal" ? "chip-mal" : "chip-aviso")}>
            <p className="flex items-start gap-2 font-bold"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{j.titulo}</p>
            {j.renglones.length > 0 && <ul className="mt-1.5 space-y-1 pl-[22px]">{j.renglones.map((r, i) => <li key={i}>{r}</li>)}</ul>}
            {j.arreglo.length > 0 && (
                <div className="mt-2.5 space-y-2 pl-[22px]">
                    <p className="font-semibold">Qué cargar en el DNS del dominio:</p>
                    {j.arreglo.map((a, i) => (
                        <div key={i}>
                            <p className="text-[11.5px] font-semibold opacity-80">{a.donde}</p>
                            <p className="mt-0.5 select-all break-words rounded-[6px] bg-background/70 px-2 py-1.5 text-foreground">{a.valor}</p>
                        </div>
                    ))}
                </div>
            )}
            <p className="mt-2.5 pl-[22px]">{j.estado === "mal" ? "Hasta que eso esté, conviene no mandar. " : ""}El cambio tarda unos minutos en verse. {otraVez}</p>
        </div>
    );
}

export function CajonInvitaciones({ abierto, alCerrar }: { abierto: boolean; alCerrar: () => void }) {
    const [d, setD] = useState<Datos | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [subiendo, setSubiendo] = useState(false);
    const [mandando, setMandando] = useState(false);
    const [avisos, setAvisos] = useState<string[]>([]);
    const archivo = useRef<HTMLInputElement>(null);

    const traer = useCallback(async () => {
        try {
            const r = await fetch("/api/censo/invitaciones", { cache: "no-store" });
            const j = await r.json();
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setD(j); setError(null);
        } catch (e) { setError(e instanceof Error ? e.message : "No se pudo traer"); }
    }, []);
    useEffect(() => { if (abierto) { setD(null); traer(); } }, [abierto, traer]);
    /* Mientras el envío de a poco está en marcha, la lista se pone al día sola: es un proceso de
       horas y quien lo mira quiere ver que avanza sin apretar nada. */
    const enMarcha = !!d?.goteo.activo;
    useEffect(() => { if (!abierto || !enMarcha) return; const iv = setInterval(traer, 15_000); return () => clearInterval(iv); }, [abierto, enMarcha, traer]);

    const [mirando, setMirando] = useState(false);
    /** Vuelve a preguntarle al DNS: es lo que se aprieta después de corregir el dominio. */
    async function mirarDominio() {
        setMirando(true);
        try {
            const r = await fetch("/api/censo/invitaciones?dns=1", { cache: "no-store" });
            const j = await r.json();
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setD(j);
            if (j.dominio?.estado === "bien") toast.success({ title: "El dominio quedó bien", description: j.dominio.titulo });
        } catch (e) { toast.error({ title: "No se pudo volver a mirar", description: e instanceof Error ? e.message : undefined }); }
        finally { setMirando(false); }
    }
    /** El dominio manda a spam lo que sale de acá: el botón de empezar lo dice en vez de disimularlo. */
    const aSpam = d?.dominio?.estado === "mal";

    const [cambiandoGoteo, setCambiandoGoteo] = useState(false);
    /** Pone en marcha, pausa o cambia el ritmo y el horario del envío de a poco. */
    async function goteo(cambio: { activo?: boolean; cadaSeg?: number; desde?: number; hasta?: number }) {
        setCambiandoGoteo(true);
        try {
            const r = await fetch("/api/censo/invitaciones", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ accion: "goteo", ...cambio }) });
            const j = await r.json();
            if (!r.ok) { toast.error({ title: "No se pudo", description: j?.error }); return; }
            setD((v) => (v ? { ...v, goteo: j.goteo } : v));
            if (cambio.activo === true) toast.success({ title: "Envío en marcha", description: j.goteo.enHorario ? "Sale la primera en menos de un minuto. Podés cerrar esta ventana: sigue solo." : `Fuera de horario: arranca a las ${j.goteo.desde} h. Podés cerrar esta ventana: sigue solo.` });
            if (cambio.activo === false) toast.success({ title: "Envío en pausa", description: "Las que faltan quedan sin enviar hasta que lo vuelvas a poner en marcha." });
        } catch { toast.error({ title: "No se pudo" }); }
        finally { setCambiandoGoteo(false); }
    }

    async function importar(f: File) {
        setSubiendo(true); setAvisos([]);
        try {
            const fd = new FormData(); fd.append("archivo", f);
            const r = await fetch("/api/censo/invitaciones", { method: "POST", body: fd });
            const j = await r.json();
            if (!r.ok) { toast.error({ title: "No se pudo leer la planilla", description: j?.error }); setAvisos(j?.errores || []); return; }
            toast.success({
                title: `${j.nuevas} ${j.nuevas === 1 ? "lote nuevo" : "lotes nuevos"}`,
                description: [j.actualizadas ? `${j.actualizadas} con el correo corregido` : "", j.repetidos ? `${j.repetidos} repetidos en la planilla` : ""].filter(Boolean).join(" · ") || "Listos para enviar.",
            });
            setAvisos(j?.errores || []);
            traer();
        } catch { toast.error({ title: "No se pudo subir la planilla" }); }
        finally { setSubiendo(false); if (archivo.current) archivo.current.value = ""; }
    }

    /** Manda YA las elegidas (el «Enviar» o «Reenviar» de un renglón). Todo el padrón va de a poco, con `goteo`. */
    async function enviar(ids: string[]) {
        setMandando(true);
        try {
            let total = 0, fallados = 0;
            for (let vuelta = 0; vuelta < 40; vuelta++) {
                const r = await fetch("/api/censo/invitaciones", {
                    method: "PUT", headers: { "content-type": "application/json" },
                    body: JSON.stringify({ accion: "enviar", ids }),
                });
                const j = await r.json();
                if (!r.ok) { toast.error({ title: "No se pudo enviar", description: j?.error }); break; }
                total += j.mandados; fallados += j.fallados;
                if (ids || !j.quedan || (!j.mandados && !j.fallados)) break;
            }
            toast[total ? "success" : "error"]({
                title: total ? `${total} ${total === 1 ? "correo enviado" : "correos enviados"}` : "No salió ninguno",
                description: fallados ? `${fallados} fallaron: mirá el motivo en la lista.` : "Con copia oculta a cada administración.",
            });
            traer();
        } finally { setMandando(false); }
    }

    async function alternarClave(v: boolean) {
        await fetch("/api/censo/invitaciones", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ accion: "clave", valor: v }) });
        traer();
    }

    async function borrar(id: string) {
        await fetch(`/api/censo/invitaciones?id=${id}`, { method: "DELETE" });
        traer();
    }

    const pendientes = d?.invitaciones.filter((i) => !i.enviadoAt).length || 0;
    const conError = d?.invitaciones.filter((i) => i.error).length || 0;
    const usadas = d?.invitaciones.filter((i) => i.usadoAt).length || 0;

    return (
        <Cajon open={abierto} onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <CajonContenido ancho="medio" titulo="Invitaciones del censo"
                descripcion="Un correo por persona, con su clave para sus lotes, desde la casilla de su administración y con copia oculta."
                pie={d ? (
                    <>
                        {/* La planilla en blanco va ANTES de «Cargar»: es el paso que viene primero.
                            Sin esto, pedirle la lista a la administración era explicarle por correo
                            qué columnas poner. */}
                        <Button variant="ghost" asChild>
                            <a href="/api/censo/invitaciones/plantilla" download>
                                <Download size={14} /> Plantilla
                            </a>
                        </Button>
                        <Button variant="outline" onClick={() => archivo.current?.click()} disabled={subiendo}>
                            {subiendo ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Cargar planilla
                        </Button>
                        {/* Mandar todo junto ya no se ofrece: 490 correos iguales en cinco minutos es como
                            se llega a spam. Lo que hay es ponerlo en marcha y que salga de a uno. */}
                        {d.goteo.activo ? (
                            <Button variant="outline" onClick={() => goteo({ activo: false })} disabled={cambiandoGoteo}>
                                {cambiandoGoteo ? <Loader2 size={14} className="animate-spin" /> : <Pause size={14} />} Pausar el envío
                            </Button>
                        ) : (
                            <Button variant={aSpam ? "outline" : undefined} onClick={() => goteo({ activo: true })} disabled={cambiandoGoteo || !d.goteo.pendientes || !d.correoListo}>
                                {cambiandoGoteo ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} {aSpam ? "Enviar igual" : "Enviar de a poco"} {d.goteo.pendientes || ""}
                            </Button>
                        )}
                    </>
                ) : undefined}>

                <input ref={archivo} type="file" accept=".xlsx,.csv" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) importar(f); }} />

                {error && !d ? <div className="p-6"><ErrorEstado mensaje={error} alReintentar={traer} /></div>
                    : !d ? <div className="p-6"><Cargando texto="Trayendo las invitaciones…" /></div>
                        : (
                            <>
                                <CajonSeccion titulo="Cómo entra la gente" icono={Mail} compacta>
                                    <button type="button" onClick={() => alternarClave(!d.conClave)}
                                        className={cn("w-full rounded-[10px] border p-3.5 text-left transition-colors",
                                            d.conClave ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_7%,transparent)]" : "border-border hover:bg-accent/40")}>
                                        <p className="flex items-center gap-2 text-[13.5px] font-bold">
                                            <span className={cn("h-[18px] w-[18px] shrink-0 rounded-[5px] border grid place-items-center",
                                                d.conClave ? "border-[var(--accion)] bg-[var(--accion)] text-white" : "border-border")}>
                                                {d.conClave && <Check size={13} strokeWidth={3} />}
                                            </span>
                                            Pedir la clave del lote
                                        </p>
                                        <p className="mt-1.5 pl-[26px] text-[12px] leading-snug text-muted-foreground">
                                            {d.conClave
                                                ? "Cada lote entra por el enlace de su correo. /registro sin clave pide la clave, y el lote lo pone la invitación: nadie puede cargar el padrón de otro."
                                                : "El censo está abierto: cualquiera que tenga el QR puede cargar cualquier lote. Sirve para una asamblea; para mandar por correo, prendelo."}
                                        </p>
                                    </button>

                                    {!d.correoListo && (
                                        <p className="mt-2.5 flex items-start gap-2 rounded-[10px] chip-aviso p-3 text-[12.5px] leading-snug">
                                            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                                            No hay desde dónde mandar: cada administración manda desde su cuenta de Gmail, que se carga en
                                            Administraciones › Correo. Sin ninguna se pueden cargar las invitaciones pero no sale ninguna.
                                        </p>
                                    )}
                                    {d.correoListo && (
                                        <p className="mt-2.5 text-[12px] text-muted-foreground">
                                            {d.copiaAdmin ? <>Cada correo sale desde la casilla de su administración, con copia oculta a esa misma casilla y a <span className="font-semibold text-foreground">{d.copiaAdmin}</span>.</>
                                                : "Cada correo sale desde la casilla de su administración, con copia oculta a esa misma casilla."}
                                        </p>
                                    )}
                                    {d.dominio && <EstadoDelDominio j={d.dominio} mirando={mirando} alMirar={mirarDominio} />}
                                </CajonSeccion>

                                <CajonSeccion titulo="Envío de a poco" icono={Timer} compacta
                                    ayuda="Las invitaciones salen de a una, con una pausa que no es siempre igual, dentro del horario, y en un orden mezclado. Mandarlas todas juntas es la forma de que el correo las tome por propaganda. Si tres seguidas fallan, se frena solo.">
                                    {(() => {
                                        const g = d.goteo;
                                        const enviadas = d.invitaciones.length - pendientes;
                                        const termina = g.terminaAt ? `${diaSemana(g.terminaAt)} a las ${hora(g.terminaAt)}` : null;
                                        const SELECTOR = "h-8 rounded-[6px] border border-border bg-background px-2 text-[12.5px] font-semibold disabled:opacity-60";
                                        return (
                                            <>
                                                <div className={cn("rounded-[10px] border p-3.5", g.activo ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_7%,transparent)]" : "border-border")}>
                                                    <p className="flex items-center gap-2 text-[13.5px] font-bold">
                                                        <span className={cn("h-2 w-2 shrink-0 rounded-full", g.activo ? (g.enHorario ? "bg-[var(--bien)] animate-pulse" : "bg-[var(--aviso)]") : "bg-muted-foreground/40")} />
                                                        {g.activo ? (g.enHorario ? "Enviando" : `En marcha, esperando a las ${g.desde} h`) : g.pendientes ? "Sin empezar" : "No queda ninguna por enviar"}
                                                        <span className="ml-auto text-[12px] font-semibold tabular-nums text-muted-foreground">{enviadas} de {d.invitaciones.length}</span>
                                                    </p>
                                                    <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-[var(--accion)] transition-[width] duration-500" style={{ width: `${d.invitaciones.length ? (enviadas / d.invitaciones.length) * 100 : 0}%` }} /></div>
                                                    {g.pendientes > 0 && termina && (
                                                        <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
                                                            {g.activo ? "A este ritmo termina el " : "Si lo ponés en marcha ahora, termina el "}<span className="font-semibold text-foreground">{termina}</span>.
                                                            {g.activo && g.proximo && g.enHorario && <> La próxima sale a las {hora(g.proximo)}.</>}
                                                        </p>
                                                    )}
                                                    {g.motivo && <p className={cn("mt-2 text-[12px] leading-snug", /fren|fallaron|No se sabe|Esperando las cuentas/.test(g.motivo) ? "tono-mal font-semibold" : "text-muted-foreground")}>{g.motivo}</p>}
                                                    {/* Desde qué cuenta sale cada grupo (25/11): cada administración, desde su casilla. */}
                                                    {g.porCuenta?.length > 0 && (
                                                        <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
                                                            {g.porCuenta.map((c) => (
                                                                <li key={c.administracionId || "general"} className="flex items-center gap-2 text-[12px]">
                                                                    <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-[6px]", c.lista ? "chip-bien" : "chip-aviso")}><Mail size={12} /></span>
                                                                    <span className="min-w-0 flex-1">
                                                                        <span className="block truncate font-semibold">{c.nombre}</span>
                                                                        <span className={cn("block truncate text-[11px]", c.lista ? "text-muted-foreground" : "tono-aviso")}>{c.administracionId ? (c.lista ? `desde ${c.cuenta}` : c.cuenta ? `${c.cuenta}: falta la clave de aplicación` : "sin cuenta de correo: sus invitaciones esperan") : "desde el servidor general"}</span>
                                                                    </span>
                                                                    <span className="shrink-0 text-right leading-tight">
                                                                        <span className="block tabular-nums text-muted-foreground">{c.enviadas} de {c.enviadas + c.pendientes}</span>
                                                                        {/* El tope diario de la casilla (25/11): cuántas salieron hoy, y si Gmail la frenó. */}
                                                                        {c.administracionId && c.tope > 0 && (
                                                                            <span className={cn("block text-[10.5px] tabular-nums", c.frenadaHasta ? "tono-aviso font-semibold" : c.hoy >= c.tope ? "tono-info" : "text-muted-foreground")}
                                                                                title={c.frenadaHasta ? "Gmail frenó esta casilla por tope de envíos: descansa hasta mañana y las demás siguen." : `Cada casilla manda hasta ${c.tope} por día; lo que no entra sigue mañana.`}>
                                                                                {c.frenadaHasta ? "Gmail la frenó: sigue mañana" : `hoy ${c.hoy}/${c.tope}`}
                                                                            </span>)}
                                                                    </span>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                    {g.conError > 0 && <p className="mt-1 text-[12px] tono-aviso">{g.conError} {g.conError === 1 ? "se intentó tres veces y no salió: no se vuelve" : "se intentaron tres veces y no salieron: no se vuelven"} a intentar sola{g.conError === 1 ? "" : "s"}. Corregí el correo y usá «Enviar» en su renglón.</p>}
                                                </div>
                                                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px]">
                                                    <label className="flex items-center gap-2">Ritmo
                                                        <select value={g.cadaSeg} disabled={cambiandoGoteo} onChange={(e) => goteo({ cadaSeg: Number(e.target.value) })} className={SELECTOR}>
                                                            {RITMOS.map((r) => <option key={r.seg} value={r.seg}>{r.rotulo}</option>)}
                                                            {!RITMOS.some((r) => r.seg === g.cadaSeg) && <option value={g.cadaSeg}>Uno cada {g.cadaSeg} s</option>}
                                                        </select>
                                                    </label>
                                                    <label className="flex items-center gap-2">De
                                                        <select value={g.desde} disabled={cambiandoGoteo} onChange={(e) => goteo({ desde: Number(e.target.value) })} className={SELECTOR}>
                                                            {Array.from({ length: 24 }, (_, h) => h).filter((h) => h < g.hasta).map((h) => <option key={h} value={h}>{h} h</option>)}
                                                        </select>
                                                        a
                                                        <select value={g.hasta} disabled={cambiandoGoteo} onChange={(e) => goteo({ hasta: Number(e.target.value) })} className={SELECTOR}>
                                                            {Array.from({ length: 24 }, (_, h) => h + 1).filter((h) => h > g.desde).map((h) => <option key={h} value={h}>{h} h</option>)}
                                                        </select>
                                                    </label>
                                                </div>
                                            </>
                                        );
                                    })()}
                                </CajonSeccion>

                                {avisos.length > 0 && (
                                    <CajonSeccion titulo={`La planilla dejó ${avisos.length} ${avisos.length === 1 ? "aviso" : "avisos"}`} icono={AlertTriangle} compacta>
                                        <ul className="space-y-1 text-[12.5px] leading-snug text-muted-foreground">
                                            {avisos.slice(0, 30).map((a, i) => <li key={i}>· {a}</li>)}
                                        </ul>
                                    </CajonSeccion>
                                )}

                                <CajonSeccion titulo={`Lotes · ${d.invitaciones.length}`} icono={Mail} compacta
                                    ayuda="La planilla puede tener una columna «lote» y otra «correo», o ninguna cabecera: la columna del correo se reconoce sola.">
                                    {d.invitaciones.length === 0 ? (
                                        <p className="text-[12.5px] text-muted-foreground">
                                            Todavía no hay ninguno. Bajá la plantilla, mandásela a la administración y cargala acá (.xlsx o .csv).
                                        </p>
                                    ) : (
                                        <>
                                            <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
                                                {pendientes > 0 && <Chip tono="aviso">{pendientes} sin enviar</Chip>}
                                                {usadas > 0 && <Chip tono="bien">{usadas} ya cargaron</Chip>}
                                                {conError > 0 && <Chip tono="mal">{conError} con error</Chip>}
                                            </div>
                                            <div className="rounded-[10px] border border-border divide-y divide-border">
                                                {d.invitaciones.map((i) => (
                                                    <div key={i.id} className="flex items-center gap-3 px-3 py-2.5">
                                                        <span className="w-[112px] shrink-0 truncate text-[13px] font-bold tabular-nums" title={i.lote}>{i.lote}</span>
                                                        <div className="min-w-0 flex-1">
                                                            {/* La invitación es por persona (21/11): el nombre va primero, que es por lo que se la busca. */}
                                                            <p className="truncate text-[12.5px]">{i.nombre ? <><span className="font-semibold">{i.nombre}</span> <span className="text-muted-foreground">· {i.email}</span></> : i.email}</p>
                                                            {/* El código se cambia acá mismo, con el lápiz (21/11): a mano o pidiendo otro. */}
                                                            <EditorCodigo className="mt-0.5" invitacionId={i.id} clave={i.clave} yaEnviado={!!i.enviadoAt} alCambiar={traer} />
                                                            {(i.enviadoAt || i.error) && (
                                                                <p className="truncate text-[11.5px] text-muted-foreground tabular-nums">
                                                                    {[i.enviadoAt ? `enviado ${fechaHora(i.enviadoAt)}${i.enviadoDesde ? ` desde ${i.enviadoDesde}` : ""}` : "", i.error || ""].filter(Boolean).join(" · ")}
                                                                </p>
                                                            )}
                                                        </div>
                                                        {i.usadoAt ? <Chip tono="bien" icono={Check}>Cargó</Chip>
                                                            : i.error ? <Chip tono="mal" icono={AlertTriangle}>Error</Chip>
                                                                : i.enviadoAt ? <Chip tono="quieto" icono={Send}>Enviado</Chip>
                                                                    : <Chip tono="aviso" icono={Clock}>Sin enviar</Chip>}
                                                        <button type="button" onClick={() => enviar([i.id])} disabled={mandando || !d.correoListo}
                                                            className="shrink-0 text-[11.5px] font-semibold text-muted-foreground hover:text-[var(--accion)] hover:underline disabled:opacity-40">
                                                            {i.enviadoAt ? "Reenviar" : "Enviar"}
                                                        </button>
                                                        <button type="button" onClick={() => borrar(i.id)}
                                                            className="shrink-0 grid h-7 w-7 place-items-center rounded-full border border-border text-muted-foreground hover:text-[var(--mal)]" aria-label={`Quitar ${i.lote}`}>
                                                            <Trash2 size={13} />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </CajonSeccion>
                            </>
                        )}
            </CajonContenido>
        </Cajon>
    );
}
