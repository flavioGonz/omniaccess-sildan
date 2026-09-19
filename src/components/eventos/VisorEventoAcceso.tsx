"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { sileo as toast } from "sileo";
import { VisorCuadro, leerDetalles } from "@/components/VisorCuadro";
import NvrTimeMachine from "@/components/dashboard/NvrTimeMachine";
import { getImagePath } from "@/lib/image-path";
import { addWatch, deleteWatch, getWatchlist } from "@/app/actions/watchlist";

/**
 * Un evento de acceso, en la ventana nueva.
 *
 * Esto NO es otro visor: es el enchufe. El visor sabe dibujar; acá vive todo lo que hay que
 * pedir, calcular o mandar para que tenga qué dibujar — el canal del NVR, los pasos
 * anteriores de la chapa, la permanencia, la lista negra, el ZIP.
 *
 * Están separados a propósito. El diálogo anterior mezclaba las dos cosas en 619 líneas, y
 * el resultado era que no se podía cambiar el aspecto sin tocar las consultas ni agregar un
 * dato sin pelearse con el layout. Con el corte, el visor se prueba con datos inventados y
 * este archivo se lee entero de una sentada.
 *
 * Toma la MISMA forma que `EventDetailsDialog` — envuelve al hijo y lo usa de disparador —
 * para que cambiar una pantalla sea cambiar un import y nada más. Las que todavía no se
 * cambiaron siguen andando con el viejo; no hay un momento en el que la aplicación esté a
 * medias.
 */

type Props = {
    event: any;
    children: React.ReactNode;
    /** Se acepta por compatibilidad con el diálogo anterior; acá no se usa. */
    timeStatus?: any;
    /** Abrir directo en la grabación del NVR. */
    autoRecording?: boolean;
    onRegister?: (plate?: string) => void;
};

const limpiar = (p?: string | null) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Las lecturas que el sistema guarda cuando NO pudo leer nada. */
const SIN_LECTURA = new Set(["", "UNKNOWN", "NOLEIDA", "NO_LEIDA", "SP", "S/P"]);
const hayChapa = (p?: string | null) => !SIN_LECTURA.has(limpiar(p));

export function VisorEventoAcceso({ event, children, autoRecording, onRegister }: Props) {
    const router = useRouter();
    const [abierto, setAbierto] = useState(false);

    const [canalNvr, setCanalNvr] = useState<number | null>(null);
    const [verGrabacion, setVerGrabacion] = useState(false);
    const [historial, setHistorial] = useState<any[] | undefined>(undefined);
    const [cargandoHistorial, setCargandoHistorial] = useState(false);
    const [vigilada, setVigilada] = useState<{ id: string; category: string } | null>(null);
    const [ocupadoLista, setOcupadoLista] = useState(false);

    const chapa = limpiar(event?.plateDetected);
    const conChapa = hayChapa(event?.plateDetected);
    const meta = useMemo(() => leerDetalles(event?.details), [event?.details]);
    const msEvento = useMemo(() => new Date(event?.timestamp).getTime(), [event?.timestamp]);
    const dispositivo = event?.device;

    /** El canal del NVR, que decide si hay grabación y clip. */
    useEffect(() => {
        if (!abierto || !dispositivo?.id) return;
        let vivo = true;
        fetch(`/api/nvr/channel?deviceId=${dispositivo.id}`, { cache: "no-store" })
            .then((r) => r.json())
            .then((d) => {
                if (!vivo) return;
                const ch = d?.channel != null ? Number(d.channel) : null;
                setCanalNvr(ch);
                if (autoRecording && ch) setVerGrabacion(true);
            })
            .catch(() => { if (vivo) setCanalNvr(null); });
        return () => { vivo = false; };
    }, [abierto, dispositivo?.id, autoRecording]);

    /** Los pasos anteriores, y si está en la lista. */
    useEffect(() => {
        if (!abierto || !conChapa) return;
        let vivo = true;
        setCargandoHistorial(true);
        fetch(`/api/events?plate=${encodeURIComponent(chapa)}&limit=50`)
            .then((r) => r.json())
            .then((d) => {
                if (!vivo) return;
                const filas = (d?.events || [])
                    .filter((e: any) => e.id !== event.id)
                    .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                setHistorial(filas);
            })
            .catch(() => { if (vivo) setHistorial([]); })
            .finally(() => { if (vivo) setCargandoHistorial(false); });

        getWatchlist()
            .then((filas: any[]) => {
                if (!vivo) return;
                const w = filas.find((r: any) => limpiar(r.plate) === chapa && r.active !== false);
                setVigilada(w ? { id: w.id, category: w.category } : null);
            })
            .catch(() => { });
        return () => { vivo = false; };
    }, [abierto, conChapa, chapa, event?.id]);

    /**
     * Cuánto estuvo adentro.
     *
     * Sólo para una SALIDA, y sólo si se encuentra la entrada que le corresponde: la última
     * anterior a esta salida. Si el equipo ya la calculó (`stayDuration`) se usa esa, que es
     * mejor dato — la sacó de su propia secuencia y no de lo que quedó guardado acá.
     *
     * Si no hay entrada previa no se inventa nada: puede ser un auto que entró antes de que
     * existiera el sistema, o una entrada que no se registró. Decir "estuvo 0 minutos" por
     * no haber encontrado la otra punta sería afirmar algo que no se sabe.
     */
    const permanenciaMs = useMemo(() => {
        if (event?.direction !== "EXIT") return null;
        if (event?.stayDuration) return Number(event.stayDuration) * 1000;
        const entradas = (historial || []).filter(
            (h: any) => h.direction === "ENTRY" && new Date(h.timestamp).getTime() < msEvento);
        if (!entradas.length) return null;
        const ultima = entradas.reduce((a: any, b: any) =>
            new Date(a.timestamp) > new Date(b.timestamp) ? a : b);
        return msEvento - new Date(ultima.timestamp).getTime();
    }, [event?.direction, event?.stayDuration, historial, msEvento]);

    const alternarLista = useCallback(async () => {
        if (!conChapa) return;
        setOcupadoLista(true);
        try {
            if (vigilada?.category === "BLACKLISTED") {
                await deleteWatch(vigilada.id);
                setVigilada(null);
                toast.success({ title: `${chapa} quitada de la lista negra` });
            } else {
                const r: any = await addWatch({
                    plate: chapa,
                    label: [meta.Marca, meta.Color].filter(Boolean).join(" "),
                    category: "BLACKLISTED",
                    notify: true,
                });
                if (r?.ok === false) throw new Error(r.error);
                setVigilada({ id: r?.row?.id || "?", category: "BLACKLISTED" });
                toast.warning({ title: `${chapa} en lista negra`, description: "Se alerta en cada detección." });
            }
        } catch (e: any) {
            toast.error({ title: "No se pudo actualizar la lista", description: e?.message });
        } finally {
            setOcupadoLista(false);
        }
    }, [conChapa, chapa, vigilada, meta.Marca, meta.Color]);

    const exportar = useCallback(() => {
        const a = document.createElement("a");
        a.href = `/api/events/${event.id}/export?pre=10&dur=30`;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast.success({
            title: "Exportando el evento",
            description: canalNvr
                ? "Foto, clip de treinta segundos y datos, en un ZIP."
                : "Foto y datos. Sin clip: esta cámara no tiene canal de NVR.",
        });
    }, [event?.id, canalNvr]);

    const registrar = useCallback((plate?: string) => {
        setAbierto(false);
        if (conChapa && onRegister) { onRegister(plate || chapa); return; }
        const cara = getImagePath(meta.FaceImage) || "";
        if (event?.accessType === "FACE" && cara) {
            router.push(`/admin/users?action=create&face=${encodeURIComponent(cara)}`);
            return;
        }
        router.push(`/admin/users?action=create${conChapa ? `&plate=${encodeURIComponent(chapa)}` : ""}`);
    }, [conChapa, onRegister, chapa, meta.FaceImage, event?.accessType, router]);

    const foto = getImagePath(event?.imagePath) || getImagePath(event?.snapshotPath) || "";

    /** La ficha, con lo que el evento ya trae del padrón. */
    const ficha = useMemo(() => {
        const u = event?.user;
        const vig = vigilada?.category === "BLACKLISTED"
            ? { etiqueta: "Lista negra", categoria: "negra" }
            : null;
        if (!u && !meta.Marca && !vig) return null;
        return {
            marca: meta.Marca || null,
            modelo: meta.Modelo || null,
            color: meta.Color || null,
            tipo: meta.Tipo || null,
            dueno: u ? {
                id: u.id,
                nombre: u.name || null,
                telefono: u.phone || null,
                unidad: u.unit?.name || null,
                apartamento: u.apartment || null,
                cochera: u.parkingSlot?.code || null,
                rol: u.role || null,
            } : null,
            vigilancia: vig,
        };
    }, [event?.user, meta.Marca, meta.Modelo, meta.Color, meta.Tipo, vigilada]);

    return (
        <>
            <span onClick={() => setAbierto(true)} className="contents">{children}</span>

            {abierto && (
                <VisorCuadro
                    fila={{
                        plate: conChapa ? event.plateDetected : "",
                        cameraName: dispositivo?.name || event?.location || null,
                        deviceId: dispositivo?.id || null,
                        timestamp: event?.timestamp,
                        snapshotUrl: foto,
                        decision: event?.decision || null,
                        direccion: event?.direction || null,
                        tipoAcceso: event?.accessType || null,
                        permanenciaMs,
                        rostroUrl: getImagePath(meta.FaceImage) || null,
                        similitud: (() => {
                            const m = String(meta.Similitud || "").match(/(\d+)/);
                            return m ? Number(m[1]) : null;
                        })(),
                        detalles: event?.details || null,
                    }}
                    ficha={ficha}
                    historial={conChapa ? (historial || []).map((h: any) => ({
                        id: h.id,
                        momento: h.timestamp,
                        camara: h.device?.name || h.location || null,
                        direccion: h.direction,
                        decision: h.decision,
                    })) : undefined}
                    cargandoHistorial={cargandoHistorial}
                    onRegistrar={registrar}
                    onGrabacion={canalNvr != null ? () => setVerGrabacion(true) : undefined}
                    hrefClip={canalNvr != null
                        ? `/api/nvr/playback?ch=${canalNvr}&t=${msEvento}&pre=10&dur=30&download=1`
                        : null}
                    onExportar={exportar}
                    onListaNegra={conChapa ? alternarLista : undefined}
                    enListaNegra={vigilada?.category === "BLACKLISTED"}
                    ocupadoLista={ocupadoLista}
                    onCerrar={() => setAbierto(false)}
                />
            )}

            {verGrabacion && canalNvr != null && dispositivo?.id && (
                <NvrTimeMachine
                    open={verGrabacion}
                    onClose={() => setVerGrabacion(false)}
                    deviceId={dispositivo.id}
                    channel={canalNvr}
                    eventTimeMs={msEvento}
                    deviceName={dispositivo?.name}
                    evidenceUrl={foto || undefined}
                    plate={conChapa ? event.plateDetected : undefined}
                />
            )}
        </>
    );
}
