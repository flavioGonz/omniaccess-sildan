"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Punto } from "@/components/mapa/Recorrido";

type Camara = { deviceId: string; lat: number; lng: number; nombre?: string };
type Calle = { id: string; name?: string; points: [number, number][] };

/**
 * Vista 3D del barrio: misma foto satelital, pero con giro e inclinacion de
 * verdad (MapLibre). Es una vista para mirar y presentar; el dibujo del
 * perimetro y las camaras se sigue haciendo en la vista plana.
 */
export default function Mapa3D({
    center, zoom, perimeter, streets, cameras, puntos, indice,
}: {
    center: [number, number];
    zoom: number;
    perimeter: [number, number][];
    streets: Calle[];
    cameras: Camara[];
    puntos: Punto[];
    indice: number;
}) {
    const cont = useRef<HTMLDivElement>(null);
    const mapa = useRef<MLMap | null>(null);
    const [listo, setListo] = useState(false);

    useEffect(() => {
        if (!cont.current || mapa.current) return;

        const m = new maplibregl.Map({
            container: cont.current,
            center: [center[1], center[0]],
            zoom,
            pitch: 55,
            bearing: -20,
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
                    calles: {
                        type: "raster",
                        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}"],
                        tileSize: 256, maxzoom: 19,
                    },
                    relieve: {
                        type: "raster-dem",
                        tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
                        tileSize: 256, maxzoom: 13, encoding: "terrarium",
                    },
                },
                layers: [
                    { id: "foto", type: "raster", source: "foto", paint: { "raster-saturation": -0.35, "raster-contrast": 0.12, "raster-brightness-max": 0.92 } },
                    { id: "calles", type: "raster", source: "calles", paint: { "raster-opacity": 0.9 } },
                ],
            } as any,
        });

        m.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showZoom: true }), "top-right");
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

        return () => { try { (m as any).__ro?.disconnect(); } catch { } m.remove(); mapa.current = null; setListo(false); };
        // solo se monta una vez: el centro se ajusta abajo
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Perimetro, calles dibujadas y camaras
    useEffect(() => {
        const m = mapa.current;
        if (!m || !listo) return;

        const geo = (id: string, data: any, capas: any[]) => {
            const src = m.getSource(id) as any;
            if (src) { src.setData(data); return; }
            m.addSource(id, { type: "geojson", data });
            capas.forEach((c) => { if (!m.getLayer(c.id)) m.addLayer(c); });
        };

        geo("perimetro", {
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

        geo("camaras", {
            type: "FeatureCollection",
            features: cameras.map((c) => ({
                type: "Feature",
                geometry: { type: "Point", coordinates: [c.lng, c.lat] },
                properties: { nombre: c.nombre || "" },
            })),
        }, [
            { id: "camaras-halo", type: "circle", source: "camaras", paint: { "circle-radius": 13, "circle-color": "#10b981", "circle-opacity": 0.18 } },
            { id: "camaras-punto", type: "circle", source: "camaras", paint: { "circle-radius": 5, "circle-color": "#10b981", "circle-stroke-width": 2, "circle-stroke-color": "#ecfdf5" } },
        ]);
    }, [listo, perimeter, streets, cameras]);

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
