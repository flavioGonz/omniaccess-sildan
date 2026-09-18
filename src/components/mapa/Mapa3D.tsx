"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Punto } from "@/components/mapa/Recorrido";
import { polilinea, posicionEnTraza, recorrida as trazaRecorrida, type TramoTraza } from "@/lib/traza";
import { svgAuto, CSS_AUTO, TAM_AUTO } from "@/lib/auto-svg";
import { burbujaVivo, montarVivo } from "@/lib/vivo";

type Camara = { deviceId: string; lat: number; lng: number; nombre?: string };

/**
 * El mismo distintivo de cámara que la vista plana.
 *
 * Antes en 3D las cámaras eran un puntito verde sin nombre, y en la práctica no se
 * distinguían del fondo. Que el marcador sea idéntico en las dos vistas también evita
 * tener que aprender dos lenguajes para leer el mismo mapa.
 */
/** El mismo autito que en la vista plana: el dibujo vive en `@/lib/auto-svg`. */
function elementoAuto() {
    const el = document.createElement("div");
    el.style.cssText = `width:${TAM_AUTO}px;height:${TAM_AUTO}px;pointer-events:none`;
    el.innerHTML = svgAuto(0);
    return el;
}

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
    center, zoom, perimeter, streets, cameras, puntos, traza = [], avance = 0, indice,
    pitch: pitchIni = 55, bearing: bearingIni = -20, onVista,
    vivo = false, ocultas = [], nombre,
}: {
    center: [number, number];
    zoom: number;
    pitch?: number;
    bearing?: number;
    /** Para que "Guardar" pueda recordar cómo quedó la vista 3D, no solo que era 3D. */
    onVista?: (v: { center: [number, number]; zoom: number; pitch: number; bearing: number }) => void;
    /** El vivo de todas las cámaras, igual que en la vista plana. */
    vivo?: boolean;
    ocultas?: string[];
    nombre?: (id: string) => string;
    perimeter: [number, number][];
    streets: Calle[];
    cameras: Camara[];
    puntos: Punto[];
    traza?: TramoTraza[];
    avance?: number;
    indice: number;
}) {
    const cont = useRef<HTMLDivElement>(null);
    // El marcador del auto vive fuera de React, asi que su animacion tambien: se inyecta
    // una sola vez en el documento.
    useEffect(() => {
        if (document.getElementById("omni-auto-css")) return;
        const st = document.createElement("style");
        st.id = "omni-auto-css";
        st.textContent = CSS_AUTO;
        document.head.appendChild(st);
    }, []);
    const mapa = useRef<MLMap | null>(null);
    const marcadores = useRef<any[]>([]);
    const auto = useRef<any>(null);
    const encuadrado = useRef<string>("");
    const burbujas = useRef<{ marcador: any; cortar: () => void }[]>([]);
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

    /**
     * Recorrido del vehiculo.
     *
     * Ojo con el orden, que ya mordio una vez con el perimetro: en el primer render
     * `puntos` esta vacio. Si con eso se crea la fuente igual, la linea queda con cero
     * coordenadas, MapLibre rechaza la capa al agregarla, y a partir de ahi la fuente YA
     * EXISTE — asi que cada corrida siguiente cortaba en "la fuente ya esta" y las capas
     * no se agregaban nunca. El resultado es el peor posible: el panel muestra el
     * recorrido con todos sus datos y sobre el mapa no se dibuja nada.
     *
     * Por eso: no se crea nada sin al menos dos puntos, y asegurar la fuente y asegurar
     * las capas son dos pasos separados. Que la fuente exista no implica que las capas
     * esten.
     */
    useEffect(() => {
        const m = mapa.current;
        if (!m || !listo) return;

        const ID_CAPAS = ["ruta-borde", "ruta-base", "ruta-hecha-halo", "ruta-hecha-borde", "ruta-hecha-linea"];
        const ID_FUENTES = ["ruta", "ruta-hecha", "vehiculo"];

        const limpiar = () => {
            for (const id of ID_CAPAS) { try { if (m.getLayer(id)) m.removeLayer(id); } catch { } }
            for (const id of ID_FUENTES) { try { if (m.getSource(id)) m.removeSource(id); } catch { } }
        };

        // Sin recorrido que dibujar, se saca lo que hubiera quedado del anterior.
        if (puntos.length < 2) { limpiar(); try { auto.current?.remove(); } catch { } auto.current = null; return; }

        // El camino real por las calles si está; la recta entre cámaras si no.
        const hayTraza = traza.length > 0;
        const enLngLat = (c: [number, number][]) => c.map(([la, ln]) => [ln, la]);
        const coords = hayTraza
            ? enLngLat(polilinea(traza))
            : puntos.map((p) => [p.lng, p.lat]);
        const hasta = Math.max(0, Math.min(indice, puntos.length - 1));
        const hechas = hayTraza
            ? enLngLat(trazaRecorrida(traza, avance))
            : coords.slice(0, hasta + 1);
        const sitio = hayTraza ? posicionEnTraza(traza, avance) : null;

        const poner = (id: string, data: any, capas: any[]) => {
            try {
                const src = m.getSource(id) as any;
                if (src) src.setData(data);
                else m.addSource(id, { type: "geojson", data });
                // Siempre, exista o no la fuente: una capa que fallo antes se agrega ahora.
                for (const c of capas) { if (!m.getLayer(c.id)) m.addLayer(c); }
            } catch { /* una capa que falla no puede llevarse las demas */ }
        };

        poner("ruta", { type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} }, [
            { id: "ruta-borde", type: "line", source: "ruta", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#0b1220", "line-width": 9, "line-opacity": 0.6 } },
            { id: "ruta-base", type: "line", source: "ruta", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#64748b", "line-width": 5, "line-opacity": 0.9 } },
        ]);
        // Una linea necesita dos puntos: con uno solo se repite, que dibuja un punto gordo.
        const hechasOk = hechas.length >= 2 ? hechas : [coords[0], coords[0]];
        poner("ruta-hecha", { type: "Feature", geometry: { type: "LineString", coordinates: hechasOk }, properties: {} }, [
            { id: "ruta-hecha-halo", type: "line", source: "ruta-hecha", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fbbf24", "line-width": 14, "line-opacity": 0.3, "line-blur": 4 } },
            { id: "ruta-hecha-borde", type: "line", source: "ruta-hecha", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#0b1220", "line-width": 9, "line-opacity": 0.65 } },
            { id: "ruta-hecha-linea", type: "line", source: "ruta-hecha", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fbbf24", "line-width": 5 } },
        ]);
        // El vehículo es un marcador de HTML y no una capa de círculos: así puede girar
        // hacia donde va, que es información que un círculo no puede dar.
        const donde = (sitio ? [sitio.pos[1], sitio.pos[0]] : hechas[hechas.length - 1] || coords[0]) as [number, number];
        try {
            if (!auto.current) {
                auto.current = new maplibregl.Marker({ element: elementoAuto(), anchor: "center" })
                    .setLngLat(donde).addTo(m);
            } else {
                auto.current.setLngLat(donde);
            }
            const giro = auto.current.getElement().querySelector(".omni-auto-giro") as HTMLElement | null;
            if (giro && sitio) giro.style.transform = `rotate(${Math.round(sitio.grados)}deg)`;
        } catch { }

        // Al abrir un recorrido se encuadra entero, una sola vez. Despues se sigue al
        // vehiculo, que es lo que hace util la reproduccion.
        // El encuadre se hace UNA vez, al abrir el flujo, y después el mapa se queda
        // quieto. Seguir al vehículo suena servicial y es lo contrario: lo deja clavado en
        // el centro y lo que se mueve es el barrio, así que se pierde justo lo que se
        // estaba mirando — por dónde va respecto de las calles y las otras cámaras.
        const firma = puntos.map((p) => p.id).join("|");
        if (encuadrado.current !== firma) {
            encuadrado.current = firma;
            try {
                const lats = puntos.map((p) => p.lat), lngs = puntos.map((p) => p.lng);
                m.fitBounds(
                    [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
                    { padding: 140, maxZoom: 18, duration: 900 },
                );
            } catch { }
        }
    }, [listo, puntos, traza, avance, indice]);

    // El auto vive fuera de React: si no se saca a mano queda pegado al mapa.
    useEffect(() => () => { try { auto.current?.remove(); } catch { } auto.current = null; }, []);

    /**
     * Las cámaras en vivo, también acá.
     *
     * El control del ojo estaba apagado en esta vista, lo que dejaba un botón gris que no
     * hacía nada y ninguna explicación de por qué. Un control que existe tiene que
     * funcionar donde se lo ve: la 3D es una vista del mismo mapa, no un producto aparte.
     */
    useEffect(() => {
        const m = mapa.current;
        const soltar = () => {
            for (const b of burbujas.current) { try { b.cortar(); b.marcador.remove(); } catch { } }
            burbujas.current = [];
        };
        soltar();
        if (!m || !listo || !vivo) return;

        for (const c of cameras) {
            if (ocultas.includes(c.deviceId)) continue;
            if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
            try {
                const el = burbujaVivo(nombre ? nombre(c.deviceId) : (c.nombre || "Cámara"));
                const video = el.querySelector("video") as HTMLVideoElement;
                const cortar = video ? montarVivo(video, c.deviceId) : () => { };
                const marcador = new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -34] })
                    .setLngLat([c.lng, c.lat]).addTo(m);
                burbujas.current.push({ marcador, cortar });
            } catch { }
        }
        return soltar;
    }, [listo, vivo, cameras, ocultas, nombre]);

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
