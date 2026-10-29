"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Send, Film, Image as ImageIcon, Mail, Smartphone, Clock, Loader2, ArrowUpRight } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Chip, ErrorEstado } from "@/components/ui/estados";
import { getSetting, updateSetting } from "@/app/actions/settings";
import { AJUSTE_AVISO_TELEGRAM, AJUSTE_AVISO_VIDEO, AVISO_CLIP_ANTES_SEG, AVISO_CLIP_DESPUES_SEG, ajustePrendido } from "@/lib/filas/constantes";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";

/**
 * «El aviso»: cuándo sale y por dónde, en palabras, con los interruptores de cada canal.
 *
 * Pedido de Nico (HB, 28/10): «desactivá el Telegram que está mandando videos, luego lo
 * activaremos; debe quedar claro el funcionamiento en el admin». Hasta hoy el aviso de filas
 * salía al grupo de Telegram con video si había un chat cargado, y nada en la ficha lo decía: el
 * interruptor «Telegram» de Notificaciones › Canales no lo frenaba. Ahora los canales del aviso
 * se ven acá, cada uno con su estado real (prendido, apagado, o sin configurar), y la regla
 * —límite, minutos, horario, uno por episodio, intervalo mínimo, escalamiento— se lee como frase.
 *
 * Los dos interruptores son ajustes de la instalación (valen para TODAS las filas) y se guardan
 * al tocarlos, sin esperar «Guardar cambios»: lo dice el texto, para que nadie crea que apagó sólo
 * esta fila.
 */

/** Minutos que el sondeo espera antes del segundo aviso (onvif-polling: QUEUE_ESCALATE_MIN, 5 sin ajuste). */
const ESCALAMIENTO_POR_DEFECTO_MIN = 5;

type Estado = {
    telegram: boolean; video: boolean; grupo: boolean;
    smtp: boolean; correos: string[]; escalarMin: number;
};

async function leer(): Promise<Estado> {
    const [tg, vid, chat, token, smtp, dest, esc] = await Promise.all(
        [AJUSTE_AVISO_TELEGRAM, AJUSTE_AVISO_VIDEO, "TELEGRAM_CHAT_ID", "TELEGRAM_BOT_TOKEN", "SMTP_HOST", "DISPATCH_RECIPIENTS", "QUEUE_ESCALATE_MIN"]
            .map((k) => getSetting(k).then((s: any) => (s?.value ?? null) as string | null)),
    );
    let correos: string[] = [];
    try { correos = (dest ? JSON.parse(dest) : []).filter((r: any) => r?.enabled && r.channel === "email" && r.address).map((r: any) => String(r.address)); }
    catch { correos = []; }
    const e = parseInt(esc || "", 10);
    return {
        telegram: ajustePrendido(tg), video: ajustePrendido(vid), grupo: !!(chat || "").trim() && !!(token || "").trim(),
        smtp: !!(smtp || "").trim(), correos, escalarMin: Number.isFinite(e) && e > 0 ? e : ESCALAMIENTO_POR_DEFECTO_MIN,
    };
}

export function AvisoFilaCanales({ limite, duranteMin, intervaloMin, avisa, alCerrar }: {
    limite: number | null; duranteMin: number; intervaloMin: number | null; avisa: boolean;
    /** Los enlaces llevan a otra pantalla: cierran el cajón. */
    alCerrar?: () => void;
}) {
    const [st, setSt] = useState<Estado | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [guardando, setGuardando] = useState<string | null>(null);

    const cargar = useCallback(() => { setError(null); leer().then(setSt).catch((e) => setError(String(e?.message || e))); }, []);
    useEffect(() => { cargar(); }, [cargar]);

    async function cambiar(clave: string, campo: "telegram" | "video", v: boolean) {
        if (!st) return;
        setGuardando(clave); setSt({ ...st, [campo]: v });
        try {
            await updateSetting(clave, v ? "true" : "false");
            toast.success({ title: campo === "telegram" ? (v ? "Avisos por Telegram prendidos" : "Avisos por Telegram apagados") : (v ? "El aviso va con video" : "El aviso va con foto"), description: "Para todas las filas." });
        } catch (e: any) { setSt((p) => p && { ...p, [campo]: !v }); toast.error({ title: "No se pudo guardar", description: e?.message }); }
        finally { setGuardando(null); }
    }

    const frase = !avisa
        ? <>Esta fila <b className="text-foreground">no avisa</b>: se cuenta y se ve en el monitor, pero no manda nada.</>
        : <>Avisa cuando hay <b className="text-foreground tabular-nums">{limite ?? "—"} o más personas</b>{" "}
            {duranteMin > 0 ? <>durante <b className="text-foreground tabular-nums">{duranteMin} min seguidos</b></> : <b className="text-foreground">en el momento</b>}, sólo dentro del{" "}
            <Link href="/admin/horarios-filas" onClick={alCerrar} className="tono-accion font-semibold">horario de la fila</Link>.
            {" "}Un aviso por cada vez que se carga{intervaloMin ? <>, y como mucho uno cada <b className="text-foreground tabular-nums">{intervaloMin} min</b></> : null}.
            {" "}Si sigue cargada {st ? <b className="text-foreground tabular-nums">{st.escalarMin} min</b> : "unos minutos"} y nadie tocó «Lo atiendo», sale un segundo aviso para el supervisor.</>;

    return (
        <div className="space-y-3">
            <p className="text-[12.5px] text-muted-foreground leading-relaxed">{frase}</p>

            <div className="rounded-[10px] border border-border bg-card divide-y divide-border">
                {error ? (
                    <ErrorEstado mensaje={error} alReintentar={cargar} titulo="No se pudo leer cómo están los canales" className="py-6" />
                ) : !st ? (
                    <div className="px-4 py-4 text-[12px] text-muted-foreground inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Leyendo los canales…</div>
                ) : (
                    <>
                        <Renglon icono={Send} titulo="Telegram"
                            estado={!st.grupo ? <Chip tono="quieto">Sin configurar</Chip> : st.telegram ? <Chip tono="bien">Prendido</Chip> : <Chip tono="aviso">Apagado</Chip>}
                            texto={!st.grupo
                                ? <>Falta el bot o el grupo en <Enlace href="/admin/settings?seccion=notificaciones&tab=canales" alCerrar={alCerrar}>Notificaciones › Canales</Enlace>.</>
                                : st.telegram
                                    ? <>El aviso sale al grupo con los botones «Lo atiendo», Foto, Video, Gráfica y Silenciar.</>
                                    : <>No sale ningún aviso de fila por Telegram. El bot igual contesta si alguien le pide /foto, /video o /estado en el grupo.</>}
                            control={<Switch checked={st.telegram} disabled={!st.grupo || guardando === AJUSTE_AVISO_TELEGRAM} onCheckedChange={(v) => cambiar(AJUSTE_AVISO_TELEGRAM, "telegram", v)} aria-label="Avisos de fila por Telegram" />} />

                        <Renglon icono={st.video ? Film : ImageIcon} titulo="Con video" apagado={!st.telegram}
                            estado={st.video ? <Chip tono="info">Video</Chip> : <Chip tono="quieto">Foto</Chip>}
                            texto={st.video
                                ? <>Telegram recibe un clip del momento ({AVISO_CLIP_ANTES_SEG} s antes y {AVISO_CLIP_DESPUES_SEG} s después), que sale por la conexión a internet del lugar. Si el clip falla, va la foto.</>
                                : <>Telegram recibe la foto marcada con las personas numeradas. Ocupa mucho menos datos que el video.</>}
                            control={<Switch checked={st.video} disabled={guardando === AJUSTE_AVISO_VIDEO} onCheckedChange={(v) => cambiar(AJUSTE_AVISO_VIDEO, "video", v)} aria-label="Aviso con video" />} />

                        <Renglon icono={Mail} titulo="Correo"
                            estado={!st.smtp ? <Chip tono="quieto">Sin configurar</Chip> : st.correos.length ? <Chip tono="bien">{st.correos.length} {st.correos.length === 1 ? "dirección" : "direcciones"}</Chip> : <Chip tono="aviso">Sin direcciones</Chip>}
                            texto={!st.smtp
                                ? <>Falta la cuenta de envío en <Enlace href="/admin/settings?seccion=notificaciones&tab=canales" alCerrar={alCerrar}>Notificaciones › Canales</Enlace>. El correo lleva la foto adentro.</>
                                : st.correos.length
                                    ? <>Va con la foto adentro a {st.correos.join(", ")}. Se cambian en <Enlace href="/admin/settings?seccion=notificaciones&tab=destinatarios" alCerrar={alCerrar}>Destinatarios</Enlace>.</>
                                    : <>Hay cuenta de envío pero nadie a quien mandar: agregá direcciones en <Enlace href="/admin/settings?seccion=notificaciones&tab=destinatarios" alCerrar={alCerrar}>Destinatarios</Enlace>.</>} />

                        <Renglon icono={Smartphone} titulo="Celulares con la app"
                            texto={<>Notificación en los celulares que instalaron OmniAccess Filas y aceptaron avisos (Notificaciones › Suscriptores).</>} />
                    </>
                )}
            </div>
            <p className="text-[11.5px] text-muted-foreground flex items-start gap-1.5"><Clock size={12} className="mt-0.5 shrink-0" />Los interruptores valen para todas las filas y se guardan al tocarlos. Lo de arriba (límite y minutos) se guarda con «Guardar cambios».</p>
        </div>
    );
}

function Renglon({ icono: I, titulo, estado, texto, control, apagado }: {
    icono: any; titulo: string; estado?: React.ReactNode; texto: React.ReactNode; control?: React.ReactNode; apagado?: boolean;
}) {
    return (
        <div className={cn("px-4 py-3 flex items-start gap-3", apagado && "opacity-55")}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-muted text-muted-foreground"><I size={15} /></span>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="text-[13px] font-semibold text-foreground">{titulo}</span>{estado}</div>
                <div className="text-[12px] text-muted-foreground leading-snug mt-0.5">{texto}</div>
            </div>
            {control && <div className="pt-1 shrink-0">{control}</div>}
        </div>
    );
}

function Enlace({ href, alCerrar, children }: { href: string; alCerrar?: () => void; children: React.ReactNode }) {
    return <Link href={href} onClick={alCerrar} className="tono-accion font-semibold inline-flex items-center gap-0.5">{children}<ArrowUpRight size={11} /></Link>;
}
