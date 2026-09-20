"use client";

import { useEffect, useMemo, useState } from "react";
import { leerCaja, type Caja } from "@/lib/recuadros";
import { ubicarEnLaEscena } from "@/lib/escena";

/**
 * Los autos parados: de dónde salen y dónde va cada uno.
 *
 * Esto vivía adentro de la capa de Leaflet, que era el único lugar que los dibujaba.
 * Cuando la vista 3D quiso dibujarlos también, quedaban dos caminos: repetir el pedido y
 * el socket ahí adentro —dos suscripciones a los mismos avisos, dos listas que se
 * desincronizan— o sacar los datos afuera y que cada vista dibuje la misma lista.
 *
 * El cálculo de DÓNDE va cada auto también está acá y no en la capa, por la misma razón:
 * es el mismo auto y tiene que quedar en el mismo lugar del barrio, lo mire uno de arriba
 * o en perspectiva. Si cada vista lo calculara por su cuenta, alcanzaría con que una se
 * olvidara del rumbo para que el auto apareciera en dos lugares distintos según cómo se
 * esté mirando el plano.
 */

export type AutoParado = {
    id: string; plate: string; persona: string | null; conocida: boolean;
    deviceId: string | null; camara: string | null;
    desde: string | null; visto: string | null;
    foto: string | null; bbox: string | null;
};

export type Camara = { deviceId: string; lat: number; lng: number; rumbo?: number; angulo?: number };

/** Un auto con su lugar ya resuelto dentro del cono de su cámara. */
export type AutoUbicado = {
    auto: AutoParado;
    cam: Camara;
    lat: number; lng: number;
    metros: number; desvio: number;
};

/** Una cámara que todavía no dice hacia dónde mira, con los autos que no se pueden ubicar. */
export type CamaraPendiente = { cam: Camara; autos: AutoParado[] };

/** Cuánto hace que está ahí, en palabras. */
export const lapso = (desde: string | null) => {
    if (!desde) return "";
    const min = Math.max(0, Math.round((Date.now() - new Date(desde).getTime()) / 60000));
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    return `${h} h ${min % 60} min`;
};

/** El dibujo del auto parado. Es el mismo en las dos vistas, a propósito. */
export const autoHtml = (plate: string, conocida: boolean, tiempo: string) => `
<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-6px)">
  <span style="padding:1px 5px;border-radius:5px;background:${conocida ? "rgba(16,185,129,.95)" : "rgba(100,116,139,.95)"};color:#fff;font-size:9.5px;font-weight:700;letter-spacing:.06em;white-space:nowrap;box-shadow:0 2px 5px rgba(0,0,0,.45)">${plate}</span>
  <span style="margin-top:1px;width:22px;height:22px;border-radius:6px;background:#0f172a;border:2px solid ${conocida ? "#10b981" : "#94a3b8"};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.5)">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L18.4 7c-.3-.6-.9-1-1.6-1H7.2c-.7 0-1.3.4-1.6 1l-2.1 4.1C2.7 11.3 2 12.1 2 13v3c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>
  </span>
  ${tiempo ? `<span style="margin-top:1px;font-size:8.5px;color:#fff;background:rgba(15,23,42,.8);padding:0 4px;border-radius:4px;white-space:nowrap">${tiempo}</span>` : ""}
</div>`;

/** Cuántos autos hay parados frente a una cámara que todavía no dice hacia dónde mira. */
export const pendienteHtml = (cuantos: number) => `
<div style="display:flex;align-items:center;gap:4px;padding:2px 7px;border-radius:999px;background:rgba(15,23,42,.9);border:1px dashed rgba(148,163,184,.8);box-shadow:0 2px 6px rgba(0,0,0,.45);white-space:nowrap">
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2.4" stroke-linecap="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L18.4 7c-.3-.6-.9-1-1.6-1H7.2c-.7 0-1.3.4-1.6 1l-2.1 4.1C2.7 11.3 2 12.1 2 13v3c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>
  <span style="color:#e2e8f0;font-size:10px;font-weight:700">${cuantos}</span>
  <span style="color:#94a3b8;font-size:9px">sin ubicar</span>
</div>`;

export function useEstacionados(camaras: Camara[], socket: any, visible = true) {
    const [autos, setAutos] = useState<AutoParado[]>([]);
    const [tipica, setTipica] = useState<Record<string, number | null>>({});

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
     * de que se desincronice — un aviso que se pierde deja un auto dibujado para siempre.
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
    const [tic, setTic] = useState(0);
    useEffect(() => {
        if (!visible) return;
        const iv = setInterval(() => setTic((n) => n + 1), 60000);
        return () => clearInterval(iv);
    }, [visible]);

    return useMemo(() => {
        const porCamara = new Map<string, CamaraPendiente>();
        for (const a of autos) {
            if (!a.deviceId) continue;
            const cam = camaras.find((c) => c.deviceId === a.deviceId);
            if (!cam) continue;
            if (!porCamara.has(a.deviceId)) porCamara.set(a.deviceId, { cam, autos: [] });
            porCamara.get(a.deviceId)!.autos.push(a);
        }

        /**
         * Las cámaras que todavía no dicen hacia dónde miran.
         *
         * Acá es donde más fácil se miente. Con `rumbo ?? 0` el auto se dibujaría al norte
         * de la cámara: un dato inventado con toda la apariencia de un dato medido. Así
         * que sin rumbo no se ubica ningún auto; en su lugar queda el contador, que dice
         * cuántos hay y qué falta hacer. Un hueco que explica cómo llenarlo es mejor que
         * un dibujo que no se puede sostener.
         */
        const ubicados: AutoUbicado[] = [];
        const pendientes: CamaraPendiente[] = [];
        for (const grupo of porCamara.values()) {
            if (grupo.cam.rumbo == null) { pendientes.push(grupo); continue; }
            for (const a of grupo.autos) {
                const caja = leerCaja(a.bbox) as Caja | null;
                const p = ubicarEnLaEscena(grupo.cam, caja, tipica[grupo.cam.deviceId] ?? null);
                ubicados.push({ auto: a, cam: grupo.cam, lat: p.lat, lng: p.lng, metros: p.metros, desvio: p.desvio });
            }
        }
        return { ubicados, pendientes, tic };
    }, [autos, camaras, tipica, tic]);
}
