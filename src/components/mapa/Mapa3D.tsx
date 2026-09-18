"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Punto } from "@/components/mapa/Recorrido";

type Camara = { deviceId: string; lat: number; lng: number; nombre?: string };

/**
 * El mismo distintivo de cámara que la vista plana.
 *
 * Antes en 3D las cámaras eran un puntito verde sin nombre, y en la práctica no se
 * distinguían del fondo. Que el marcador sea idéntico en las dos vistas también evita
 * tener que aprender dos lenguajes para leer el mismo mapa.
 */
function marcadorCamara(nombre: string) {
    const el = document.createElement("div");
    el.style.cssText = "display:flex;flex-direction:column;align-items:center;transform:translateY(-4px);pointer-events:none";
    el.innerHTML = `
        <span style="margin-bottom:3px;padding:1px 6px;border-radius:6px;background:rgba(17,17,17,.85);color:#fff;
            font:700 10px/1.5 ui-sans-serif,system-ui;white-space:nowrap">${nombre}</span>
        <span style="width:30px;height:30px;border-radius:8px;background:#2563eb;border:2px solid #fff;display:flex;
            align-items:center;justify-content:center;box-shadow:0 3px 6px rgba(0,0,0,.4)">
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff"
                stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>
        </span>`;
    return el;
}
type Calle = { id: string; name?: string; points: [number, number][] };

/**
 * Vista 3D del barrio: misma foto satelital, pero con giro e inclinacion de
 * verdad (MapLibre). Es una vista para mirar y presentar; el dibujo del
 * perimetro y las camaras se sigue haciendo en la vista plana.
 */
export default function Mapa3D({
    center, zoom, perimeter, streets, cameras, puntos, indice,
    pitch: pitchIni = 55, bearing: bearingIni = -20, onVista,
}: {
    center: [number, number];
    zoom: number;
    pitch?: number;
    bearing?: number;
    /** Para que "Guardar" pueda recordar cómo quedó la vista 3D, no solo que era 3D. */
    onVista?: (v: { center: [number, number]; zoom: number; pitch: number; bearing: number }) => void;
    perimeter: [number, number][];
    streets: Calle[];
    cameras: Camara[];
    puntos: Punto[];
    indice: number;
}) {
    const cont = useRef<HTMLDivElement>(null);
    const mapa = useRef<MLMap | null>(null);
    const marcadores = useRef<any[]>([]);
    // En un ref para que el efecto de montaje no dependa de la identidad del callback.
    const onVistaRef = useRef(onVista);
    onVistaRef.current = onVista;
    const [listo, setListo] = useState(false);

    useEffect(() => {
        if (!cont.current || mapa.current) return;

        const m = new maplibregl.Map({
            container: cont.current,
            center: [center[1], center[0]],
            zoom,
            pitch: pitchIni,
            bearing: bearingIni,
            maxPitch: 80,
            attributionControl: { compact: true },
            style: {
                version: 8,
                glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
                sources: {
                    foto: {
                        type: "raster",
                        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
                        tileSize: 256, maxzoom: 19,
                        attribution: "&copy; Esri",
                    },
                    // Nombres de calles: las capas de referencia de Esri no llegan al
                    // detalle de un barrio, asi que los rotulos salen de CARTO (OSM).
                    calles: {
                        type: "raster",
                        tiles: [
                            "https://a.basemaps.cartocdn.com/rastertiles/dark_only_labels/{z}/{x}/{y}.png",
                            "https://b.basemaps.cartocdn.com/rastertiles/dark_only_labels/{z}/{x}/{y}.png",
                            "https://c.basemaps.cartocdn.com/rastertiles/dark_only_labels/{z}/{x}/{y}.png",
                        ],
                        tileSize: 256, maxzoom: 18,
                        attribution: "&copy; OpenStreetMap &copy; CARTO",
                    },
                    relieve: {
                        type: "raster-dem",
                        tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
                        tileSize: 256, maxzoom: 13, encoding: "terrarium",
                    },
                },
                layers: [
                    { id: "foto", type: "raster", source: "foto", paint: { "raster-saturation": -0.35, "raster-contrast": 0.12, "raster-brightness-max": 0.92 } },
                    { id: "calles", type: "raster", source: "calles", paint: { "raster-opacity": 1 } },
                ],
            } as any,
        });

        m.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showZoom: true }), "bottom-right");
        m.touchZoomRotate.enableRotation();
        m.on("error", (e: any) => console.warn("[mapa3d]", e?.error?.message || e));
        m.on("load", () => {
            try { m.setTerrain({ source: "relieve", exaggeration: 1.3 }); } catch (e) { console.warn("[mapa3d] sin relieve", e); }
            try { (m as any).setSky?.({ "sky-color": "#0b1220", "horizon-color": "#1e293b", "fog-color": "#0b1220", "fog-ground-blend": 0.55 }); } catch { }
            mapa.current = m;
            setListo(true);
            // el contenedor termina de tomar su alto despues del montaje:
            // sin este ajuste el lienzo queda con el tamano equivocado y se ve negro
            requestAnimationFrame(() => m.resize());
            setTimeout(() => m.resize(), 300);
        });

        const ro = new ResizeObserver(() => m.resize());
        ro.observe(cont.current);
        (m as any).__ro = ro;

        // Se avisa al terminar cada movimiento, no en cada cuadro: alcanza para que
        // "Guardar" recuerde dónde quedó la vista y no hace trabajar a React de más.
        const avisar = () => {
            try {
                const c = m.getCenter();
                onVistaRef.current?.({ center: [c.lat, c.lng], zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() });
            } catch { }
        };
        m.on("moveend", avisar);
        m.on("pitchend", avisar);
        m.on("rotateend", avisar);

        return () => { try { (m as any).__ro?.disconnect(); } catch { } m.remove(); mapa.current = null; setListo(false); };
        // solo se monta una vez: el centro se ajusta abajo
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Perimetro, calles dibujadas y camaras
    useEffect(() => {
        const m = mapa.current;
        if (!m || !listo) return;

        // Cada capa va aislada.
        //
        // Antes iban en fila dentro del mismo efecto, y eso escondía un problema serio:
        // este barrio todavía no tiene el perímetro dibujado, así que el polígono salía
        // con la lista de vértices vacía, MapLibre lo rechazaba y la excepción cortaba el
        // efecto entero — antes de llegar a las cámaras. Por eso en 3D no se veía ninguna.
        const geo = (id: string, data: any, capas: any[]) => {
            try {
                const src = m.getSource(id) as any;
                if (src) { src.setData(data); return; }
                m.addSource(id, { type: "geojson", data });
                capas.forEach((c) => { if (!m.getLayer(c.id)) m.addLayer(c); });
            } catch { /* una capa que falla no puede llevarse las demás */ }
        };

        if (perimeter.length >= 3) geo("perimetro", {
            type: "Feature",
            geometry: { type: "Polygon", coordinates: [perimeter.map((p) => [p[1], p[0]])] },
            properties: {},
        }, [
            { id: "perimetro-relleno", type: "fill", source: "perimetro", paint: { "fill-color": "#22c55e", "fill-opacity": 0.07 } },
            { id: "perimetro-borde", type: "line", source: "perimetro", paint: { "line-color": "#22c55e", "line-width": 2, "line-opacity": 0.8 } },
        ]);

        geo("calles-barrio", {
            type: "FeatureCollection",
            features: streets.map((s) => ({
                type: "Feature",
                geometry: { type: "LineString", coordinates: s.points.map((p) => [p[1], p[0]]) },
                properties: { name: s.name || "" },
            })),
        }, [
            { id: "calles-barrio-linea", type: "line", source: "calles-barrio", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#38bdf8", "line-width": 4, "line-opacity": 0.85 } },
        ]);

        // Las cámaras van como marcadores de HTML y no como capa de círculos: así llevan
        // el nombre puesto, se ven igual que en la vista plana y no dependen de que el
        // estilo tenga cargadas las fuentes para rotular.
        for (const mk of marcadores.current) { try { mk.remove(); } catch { } }
        marcadores.current = [];
        for (const c of cameras) {
            if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
            try {
                marcadores.current.push(
                    new maplibregl.Marker({ element: marcadorCamara(c.nombre || "Cámara"), anchor: "bottom" })
                        .setLngLat([c.lng, c.lat])
                        .addTo(m),
                );
            } catch { }
        }
    }, [listo, perimeter, streets, cameras]);

    // Los marcadores viven fuera de React: si no se sacan a mano quedan pegados al mapa.
    useEffect(() => () => {
        for (const mk of marcadores.current) { try { mk.remove(); } catch { } }
        marcadores.current = [];
    }, []);

    // Recorrido del vehiculo
    useEffect(() => {
        const m = mapa.current;
        if (!m || !listo) return;

        const hasta = Math.min(indice, puntos.length - 1);
        const coords = puntos.map((p) => [p.lng, p.lat]);
        const hechas = coords.slice(0, hasta + 1);

        const poner = (id: string, data: any, capas: any[]) => {
            const src = m.getSource(id) as any;
            if (src) { src.setData(data); return; }
            m.addSource(id, { type: "geojson", data });
            capas.forEach((c) => { if (!m.getLayer(c.id)) m.addLayer(c); });
        };

        poner("ruta", { type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} }, [
            { id: "ruta-base", type: "line", source: "ruta", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#38bdf8", "line-width": 3, "line-opacity": 0.35, "line-dasharray": [1, 2] } },
        ]);
        poner("ruta-hecha", { type: "Feature", geometry: { type: "LineString", coordinates: hechas.length ? hechas : coords.slice(0, 1) }, properties: {} }, [
            { id: "ruta-hecha-halo", type: "line", source: "ruta-hecha", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#f59e0b", "line-width": 11, "line-opacity": 0.2, "line-blur": 3 } },
            { id: "ruta-hecha-linea", type: "line", source: "ruta-hecha", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fbbf24", "line-width": 4 } },
        ]);
        poner("vehiculo", {
            type: "FeatureCollection",
            features: hechas.length ? [{ type: "Feature", geometry: { type: "Point", coordinates: hechas[hechas.length - 1] }, properties: {} }] : [],
        }, [
            { id: "vehiculo-halo", type: "circle", source: "vehiculo", paint: { "circle-radius": 16, "circle-color": "#fbbf24", "circle-opacity": 0.22 } },
            { id: "vehiculo-punto", type: "circle", source: "vehiculo", paint: { "circle-radius": 7, "circle-color": "#fbbf24", "circle-stroke-width": 3, "circle-stroke-color": "#fff7ed" } },
        ]);

        if (hechas.length) {
            m.easeTo({ center: hechas[hechas.length - 1] as [number, number], duration: 700 });
        }
    }, [listo, puntos, indice]);

    // Centro del barrio cuando cambia la configuracion
    useEffect(() => {
        const m = mapa.current;
        if (m && listo && !puntos.length) m.easeTo({ center: [center[1], center[0]], zoom, duration: 600 });
    }, [listo, center, zoom, puntos.length]);

    return <div ref={cont} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />;
}

/** Vuelve el mapa al norte y quita la inclinacion. */
export function nortear(m: MLMap | null) {
    m?.easeTo({ bearing: 0, pitch: 0, duration: 500 });
}
