"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Clock, Download, Loader2, Mail, Send, Trash2, Upload } from "lucide-react";
import { sileo as toast } from "sileo";
import { Button } from "@/components/ui/button";
import { Cajon, CajonContenido, CajonSeccion } from "@/components/ui/cajon";
import { Chip, Cargando, ErrorEstado } from "@/components/ui/estados";
import { fechaHora } from "@/lib/fechas";
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
 */

type Invitacion = {
    id: string; lote: string; email: string; nombre: string; clave: string;
    enviadoAt: string | null; usadoAt: string | null; intentos: number; error: string | null;
};
type Datos = { conClave: boolean; correoListo: boolean; copiaAdmin: string; invitaciones: Invitacion[] };

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

    /** Manda tanda tras tanda hasta que no queda ninguno: el servidor manda 25 por vuelta. */
    async function enviar(ids?: string[]) {
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
                description: fallados ? `${fallados} fallaron: mirá el motivo en la lista.` : "Con copia a la administración.",
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
                descripcion="Un correo por lote, con su clave, y con copia a la administración."
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
                        <Button onClick={() => enviar()} disabled={mandando || !pendientes || !d.correoListo}>
                            {mandando ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                            Enviar {pendientes || ""}
                        </Button>
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
                                            Falta el servidor de correo: cargalo en Ajustes → Sistema → Correo (SMTP). Sin eso se pueden
                                            cargar las invitaciones pero no sale ninguna.
                                        </p>
                                    )}
                                    {d.correoListo && (
                                        <p className="mt-2.5 text-[12px] text-muted-foreground">
                                            {d.copiaAdmin ? <>Cada correo va con copia a <span className="font-semibold text-foreground">{d.copiaAdmin}</span>.</>
                                                : "Sin copia a la administración: cargala en Ajustes → Correo para tener la constancia del envío."}
                                        </p>
                                    )}
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
                                                        <span className="w-[74px] shrink-0 text-[13px] font-bold tabular-nums">{i.lote}</span>
                                                        <div className="min-w-0 flex-1">
                                                            <p className="truncate text-[12.5px]">{i.email}</p>
                                                            <p className="truncate text-[11.5px] text-muted-foreground tabular-nums">
                                                                {i.clave}
                                                                {i.enviadoAt && ` · enviado ${fechaHora(i.enviadoAt)}`}
                                                                {i.error && ` · ${i.error}`}
                                                            </p>
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
