"use client";

import { useEffect, useMemo, useState } from "react";
import { Marker, Polygon } from "react-leaflet";
import { AnimatePresence } from "framer-motion";
import L from "leaflet";
import { leerCaja, area as areaDe, type Caja } from "@/lib/recuadros";
import { conoDeVision, ubicarEnLaEscena } from "@/lib/escena";

/**
 * Los autos parados, dibujados dentro de lo que mira cada cámara.
 *
 * El problema que resuelve: una estadía guarda la posición de la CÁMARA, no la del auto.
 * Poner el ícono ahí sería afirmar un punto que nadie midió. Con el rumbo de la cámara y
 * el recuadro de la chapa —de qué lado del cuadro cayó, y cuánto ocupa— el auto se ubica
 * dentro del cono: aproximado, pero fundado, y siempre en un lugar donde la cámara
 * efectivamente puede verlo.
 *
 * El cono se dibuja tenue y sólo cuando hay algo parado ahí. Un plano con siete conos
 * permanentes se vuelve ilegible, y el cono no es el dato: es la explicación de por qué el
 * auto está dibujado donde está.
 */

export type AutoParado = {
    id: string; plate: string; persona: string | null; conocida: boolean;
    deviceId: string | null; camara: string | null;
    desde: string | null; visto: string | null;
    foto: string | null; bbox: string | null;
};

const lapso = (desde: string | null) => {
    if (!desde) return "";
    const min = Math.max(0, Math.round((Date.now() - new Date(desde).getTime()) / 60000));
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    return `${h} h ${min % 60} min`;
};

const autoHtml = (plate: string, conocida: boolean, tiempo: string) => `
<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-6px)">
  <span style="padding:1px 5px;border-radius:5px;background:${conocida ? "rgba(16,185,129,.95)" : "rgba(100,116,139,.95)"};color:#fff;font-size:9.5px;font-weight:700;letter-spacing:.06em;white-space:nowrap;box-shadow:0 2px 5px rgba(0,0,0,.45)">${plate}</span>
  <span style="margin-top:1px;width:22px;height:22px;border-radius:6px;background:#0f172a;border:2px solid ${conocida ? "#10b981" : "#94a3b8"};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.5)">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L18.4 7c-.3-.6-.9-1-1.6-1H7.2c-.7 0-1.3.4-1.6 1l-2.1 4.1C2.7 11.3 2 12.1 2 13v3c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>
  </span>
  ${tiempo ? `<span style="margin-top:1px;font-size:8.5px;color:#fff;background:rgba(15,23,42,.8);padding:0 4px;border-radius:4px;white-space:nowrap">${tiempo}</span>` : ""}
</div>`;

/** Cuántos autos hay parados frente a una cámara que todavía no dice hacia dónde mira. */
const pendienteHtml = (cuantos: number) => `
<div style="display:flex;align-items:center;gap:4px;padding:2px 7px;border-radius:999px;background:rgba(15,23,42,.9);border:1px dashed rgba(148,163,184,.8);box-shadow:0 2px 6px rgba(0,0,0,.45);white-space:nowrap">
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2.4" stroke-linecap="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L18.4 7c-.3-.6-.9-1-1.6-1H7.2c-.7 0-1.3.4-1.6 1l-2.1 4.1C2.7 11.3 2 12.1 2 13v3c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>
  <span style="color:#e2e8f0;font-size:10px;font-weight:700">${cuantos}</span>
  <span style="color:#94a3b8;font-size:9px">sin ubicar</span>
</div>`;

export type SeñalSinRumbo = {
    deviceId: string; camara: string | null; autos: AutoParado[]; x: number; y: number;
} | null;

export type SeñalAuto = {
    auto: AutoParado; metros: number; desvio: number; x: number; y: number;
} | null;

export function CapaEstacionados({ camaras, socket, alTocar, alSeñalar, alGirar, alSeñalarAuto, visible = true }: {
    camaras: { deviceId: string; lat: number; lng: number; rumbo?: number; angulo?: number }[];
    /** El socket que ya tiene el mapa abierto. Null mientras no conectó. */
    socket: any;
    alTocar?: (auto: AutoParado) => void;
    /** El puntero sobre una cámara sin rumbo. El padre dibuja la tarjeta. */
    alSeñalar?: (s: SeñalSinRumbo) => void;
    /** Llevar a girar esa cámara. */
    alGirar?: (deviceId: string) => void;
    /** El puntero sobre un auto parado. El padre dibuja la ficha con su captura. */
    alSeñalarAuto?: (s: SeñalAuto) => void;
    visible?: boolean;
}) {
    const [autos, setAutos] = useState<AutoParado[]>([]);
    const [tipica, setTipica] = useState<Record<string, number | null>>({});
    /* La cámara cuyo cono se está mostrando. Null = ninguno, que es casi siempre. */
    const [señalada, setSeñalada] = useState<string | null>(null);

    const pedir = async () => {
        try {
            const r = await fetch("/api/tracking/estacionados", { cache: "no-store" });
            if (!r.ok) return;
            const d = await r.json();
            setAutos(d.autos || []);
            setTipica(d.areaTipica || {});
        } catch { /* el plano sigue siendo un plano sin esto */ }
    };

    useEffect(() => { if (visible) pedir(); }, [visible]);

    /**
     * En vivo, por los dos avisos que manda el servidor.
     *
     * Se vuelve a pedir la lista entera en vez de agregar o quitar la fila del aviso: son
     * pocos autos, y reconstruir el estado a partir de avisos sueltos es la forma segura
     * de que se desincronice —un aviso que se pierde deja un auto dibujado para siempre.
     */
    useEffect(() => {
        if (!socket || !visible) return;
        const refrescar = () => pedir();
        socket.on("estadia_abierta", refrescar);
        socket.on("estadia_cerrada", refrescar);
        return () => {
            socket.off("estadia_abierta", refrescar);
            socket.off("estadia_cerrada", refrescar);
        };
    }, [socket, visible]);

    /* El reloj corre aunque no pase nada: un auto que lleva 59 minutos tiene que decir 1 h
       al minuto siguiente sin esperar a que otro auto entre o salga. */
    const [, tic] = useState(0);
    useEffect(() => {
        if (!visible) return;
        const iv = setInterval(() => tic((n) => n + 1), 60000);
        return () => clearInterval(iv);
    }, [visible]);

    const porCamara = useMemo(() => {
        const m = new Map<string, { cam: typeof camaras[number]; autos: AutoParado[] }>();
        for (const a of autos) {
            if (!a.deviceId) continue;
            const cam = camaras.find((c) => c.deviceId === a.deviceId);
            if (!cam) continue;
            if (!m.has(a.deviceId)) m.set(a.deviceId, { cam, autos: [] });
            m.get(a.deviceId)!.autos.push(a);
        }
        return [...m.values()];
    }, [autos, camaras]);

    if (!visible || !porCamara.length) return null;

    /**
     * Las cámaras que todavía no dicen hacia dónde miran.
     *
     * Éste es el caso de todas las que ya estaban cargadas antes de que existiera el
     * rumbo, y hay que tratarlo con cuidado porque es donde más fácil se miente. Con
     * `rumbo ?? 0` el cono apuntaría al norte y los autos se dibujarían al norte de la
     * cámara: un dato inventado con toda la apariencia de un dato medido.
     *
     * Así que sin rumbo no se dibuja ni el cono ni los autos sueltos. En su lugar va un
     * contador sobre la cámara que dice cuántos hay y qué falta hacer. Un hueco que
     * explica cómo llenarlo es mejor que un dibujo que no se puede sostener.
     */
    const conRumbo = porCamara.filter((x) => x.cam.rumbo != null);
    const sinRumbo = porCamara.filter((x) => x.cam.rumbo == null);

    return (
        <>
            {/*
              * El cono se dibuja SOLO mientras se señala un auto de esa cámara.
              *
              * Permanente contaba bien la historia —por qué el auto está dibujado ahí— pero
              * la contaba todo el tiempo, y un plano con un triángulo celeste clavado sobre
              * cada calle deja de ser un plano. El cono no es el dato: es la explicación del
              * dato, y una explicación tiene que aparecer cuando alguien pregunta.
              */}
            <AnimatePresence>
                {señalada && (() => {
                    const cam = conRumbo.find((c) => c.cam.deviceId === señalada)?.cam;
                    if (!cam) return null;
                    return (
                        <Polygon key={`cono-${cam.deviceId}`} positions={conoDeVision(cam)}
                            pathOptions={{
                                color: "#38bdf8", weight: 1, opacity: 0.45,
                                fillColor: "#38bdf8", fillOpacity: 0.09,
                                // El cono explica, no se toca: los clics son de los lotes de abajo.
                                interactive: false,
                            }} />
                    );
                })()}
            </AnimatePresence>

            {/*
              * El aviso NO va en un tooltip de Leaflet.
              *
              * El de Leaflet es una caja negra sin estilo que se estira con el texto: con
              * tres renglones de explicación ocupaba media pantalla y tapaba justo el plano
              * que uno vino a mirar. Y sobre todo, no se puede tocar — así que lo único que
              * podía hacer era DECIR los pasos para girar la cámara en vez de ofrecerlos.
              *
              * Acá sale al padre, que dibuja una tarjeta propia con la acción adentro.
              */}
            {sinRumbo.map(({ cam, autos: suyos }) => (
                <Marker key={`sinrumbo-${cam.deviceId}`} position={[cam.lat, cam.lng]}
                    icon={L.divIcon({
                        className: "bg-transparent border-0",
                        html: pendienteHtml(suyos.length),
                        iconSize: [70, 26], iconAnchor: [35, -6],
                    })}
                    eventHandlers={{
                        mouseover: (e: any) => alSeñalar?.({
                            deviceId: cam.deviceId, camara: suyos[0]?.camara || null, autos: suyos,
                            x: e.originalEvent?.clientX ?? 0, y: e.originalEvent?.clientY ?? 0,
                        }),
                        mousemove: (e: any) => alSeñalar?.({
                            deviceId: cam.deviceId, camara: suyos[0]?.camara || null, autos: suyos,
                            x: e.originalEvent?.clientX ?? 0, y: e.originalEvent?.clientY ?? 0,
                        }),
                        mouseout: () => alSeñalar?.(null),
                        click: () => alGirar?.(cam.deviceId),
                    }} />
            ))}

            {conRumbo.flatMap(({ cam, autos: suyos }) =>
                suyos.map((a) => {
                    const caja = leerCaja(a.bbox) as Caja | null;
                    const p = ubicarEnLaEscena(cam, caja, tipica[cam.deviceId] ?? null);
                    const tiempo = lapso(a.desde);
                    const señalar = (e: any) => {
                        setSeñalada(cam.deviceId);
                        alSeñalarAuto?.({
                            auto: a, metros: p.metros, desvio: p.desvio,
                            x: e.originalEvent?.clientX ?? 0, y: e.originalEvent?.clientY ?? 0,
                        });
                    };
                    return (
                        <Marker key={a.id} position={[p.lat, p.lng]}
                            icon={L.divIcon({
                                className: "bg-transparent border-0",
                                html: autoHtml(a.plate, a.conocida, tiempo),
                                iconSize: [46, 46], iconAnchor: [23, 23],
                            })}
                            eventHandlers={{
                                click: () => alTocar?.(a),
                                mouseover: señalar,
                                mousemove: señalar,
                                mouseout: () => { setSeñalada(null); alSeñalarAuto?.(null); },
                            }} />
                    );
                }),
            )}
        </>
    );
}
