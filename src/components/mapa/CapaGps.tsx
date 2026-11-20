"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Marker, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { rastreadoresGps, recorridoGps, type PuntoGps, type Rastreador } from "@/app/actions/gps";
import { hace } from "@/lib/fechas";

/**
 * Los rastreadores GPS sobre el mapa: dónde está cada uno, y por dónde anduvo el que se toca.
 *
 * Pedido de Nico (20/11): «debes agregarlo en el mapa con su posición y datos».
 *
 * Lo que el dibujo dice sin que haya que abrir nada, porque es lo que importa de un vistazo:
 *  · **Verde** — está en línea y la posición es de recién: el vehículo está ahí.
 *  · **Ámbar** — está en línea pero la posición es vieja: quedó bajo techo y sin satélites. El
 *    punto es dónde ENTRÓ, no necesariamente dónde está. Pintarlo igual que el verde sería
 *    afirmar algo que el equipo no sabe.
 *  · **Gris** — no reporta. Es la última posición que se supo.
 *  · La flecha gira con el rumbo sólo si se está moviendo: un auto quieto no tiene rumbo, y el
 *    que informa el equipo parado es el último que tuvo.
 *
 * El recorrido se pide recién al tocar un rastreador: son miles de puntos por vehículo y por día,
 * y cargarlos todos para un mapa que casi siempre se mira sin tocarlos sería gastar de más.
 */

const REFRESCO_MS = 15_000;
/** Con una posición más vieja que esto, estando en línea, se entiende que perdió los satélites. */
const POSICION_VIEJA_MS = 10 * 60_000;
const VERDE = "#10b981", AMBAR = "#f59e0b", GRIS = "#64748b";

const tonoDe = (r: Rastreador) => {
    if (!r.enLinea) return GRIS;
    const vieja = !r.cuando || Date.now() - new Date(r.cuando).getTime() > POSICION_VIEJA_MS;
    return vieja ? AMBAR : VERDE;
};

function icono(r: Rastreador): L.DivIcon {
    const c = tonoDe(r);
    const andando = (r.velocidad || 0) > 3;
    const rotulo = (r.matricula || r.nombre || r.imei.slice(-6)).replace(/[<>&]/g, "");
    /* Andando: una flecha que apunta al rumbo. Quieto: un punto. */
    const forma = andando
        ? `<svg width="18" height="18" viewBox="0 0 24 24" style="transform:rotate(${r.rumbo || 0}deg)"><path d="M12 2 L19 20 L12 16 L5 20 Z" fill="#fff"/></svg>`
        : `<span style="width:9px;height:9px;border-radius:50%;background:#fff;display:block"></span>`;
    return L.divIcon({
        className: "bg-transparent border-0",
        html: `<div style="display:flex;flex-direction:column;align-items:center;gap:3px">
            <div style="width:34px;height:34px;border-radius:50%;background:${c};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.45);display:grid;place-items:center">${forma}</div>
            <div style="padding:1px 7px;border-radius:999px;background:rgba(10,14,20,.85);color:#fff;font:700 11px/16px Outfit,system-ui,sans-serif;white-space:nowrap">${rotulo}</div>
        </div>`,
        iconSize: [90, 56], iconAnchor: [45, 17], popupAnchor: [0, -18],
    });
}

export function CapaGps() {
    const mapa = useMap();
    const [lista, setLista] = useState<Rastreador[]>([]);
    const [elegido, setElegido] = useState<string | null>(null);
    const [recorrido, setRecorrido] = useState<PuntoGps[]>([]);
    const volo = useRef(false);

    const traer = useCallback(async () => {
        /* Sólo los dados de alta. Uno que se presentó solo todavía no es de nadie: el puerto
           está abierto a internet, y un IMEI inventado con una posición inventada no tiene que
           poder dibujarse en el mapa de operación. Se acepta primero en Dispositivos. */
        try { setLista((await rastreadoresGps()).filter((r) => r.deviceId && r.lat !== null && r.lon !== null)); }
        catch { /* sin permiso o sin red: la capa no se dibuja y el mapa sigue andando */ }
    }, []);
    useEffect(() => { traer(); const iv = setInterval(traer, REFRESCO_MS); return () => clearInterval(iv); }, [traer]);

    /* Llegar con ?gps=<imei> (desde Dispositivos) lleva el mapa al rastreador, una sola vez. El
       rastreador puede estar a kilómetros del barrio que el mapa muestra por defecto. */
    useEffect(() => {
        if (volo.current || !lista.length) return;
        let pedido: string | null = null;
        try { pedido = new URLSearchParams(window.location.search).get("gps"); } catch { /* sin URL */ }
        if (!pedido) return;
        const r = lista.find((x) => x.imei === pedido);
        if (!r) return;
        volo.current = true;
        mapa.setView([r.lat!, r.lon!], 17);
        setElegido(r.imei);
    }, [lista, mapa]);

    useEffect(() => {
        if (!elegido) { setRecorrido([]); return; }
        let vivo = true;
        recorridoGps(elegido, 24).then((p) => { if (vivo) setRecorrido(p); }).catch(() => { });
        return () => { vivo = false; };
    }, [elegido, lista]);

    if (!lista.length) return null;
    return (
        <>
            {recorrido.length > 1 && (
                <Polyline positions={recorrido.map((p) => [p.lat, p.lon] as [number, number])}
                    pathOptions={{ color: "#38bdf8", weight: 4, opacity: 0.85, lineCap: "round", lineJoin: "round" }} />
            )}
            {lista.map((r) => (
                <Marker key={r.imei} position={[r.lat!, r.lon!]} icon={icono(r)} zIndexOffset={1500}
                    eventHandlers={{ click: () => setElegido(r.imei) }}>
                    <Popup>
                        <div style={{ font: "13px/1.45 Outfit,system-ui,sans-serif", minWidth: 210 }}>
                            <div style={{ fontWeight: 700, fontSize: 14 }}>{r.nombre || `Rastreador ${r.imei.slice(-6)}`}</div>
                            <div style={{ color: "#64748b", fontSize: 11.5, marginBottom: 6 }}>
                                {r.matricula ? `${r.matricula} · ` : ""}IMEI {r.imei}
                            </div>
                            <Renglon k="Estado" v={r.enLinea ? `En línea · reportó ${hace(r.ultimoLatido)}` : `Sin reportar desde ${hace(r.ultimoLatido, "nunca")}`} />
                            <Renglon k="Posición" v={`de ${hace(r.cuando)}`} aviso={tonoDe(r) === AMBAR ? "sin satélites desde entonces" : undefined} />
                            <Renglon k="Motor" v={r.encendido === null ? "—" : r.encendido ? "Encendido" : "Apagado"} />
                            <Renglon k="Velocidad" v={`${r.velocidad || 0} km/h`} />
                            <Renglon k="Batería del vehículo" v={r.voltaje !== null ? `${r.voltaje.toFixed(1).replace(".", ",")} V` : "—"} />
                            <div style={{ color: "#64748b", fontSize: 11.5, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
                                {r.lat!.toFixed(5)}, {r.lon!.toFixed(5)}
                                {recorrido.length > 1 && elegido === r.imei ? ` · ${recorrido.length} puntos en 24 h` : ""}
                            </div>
                        </div>
                    </Popup>
                </Marker>
            ))}
        </>
    );
}

function Renglon({ k, v, aviso }: { k: string; v: string; aviso?: string }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ color: "#64748b" }}>{k}</span>
            <span style={{ fontWeight: 600, textAlign: "right" }}>{v}{aviso ? <span style={{ display: "block", color: "#b45309", fontWeight: 500, fontSize: 11 }}>{aviso}</span> : null}</span>
        </div>
    );
}
