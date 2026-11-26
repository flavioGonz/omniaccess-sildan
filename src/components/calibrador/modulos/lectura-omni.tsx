"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { sileo as toast } from "sileo";
import { Route, Square, Minus, Crop, Crosshair, Gauge, Sparkles, ScanLine, ArrowUpDown, MoveUpRight, ListOrdered, Trash2, Eye, EyeOff, Timer, Waypoints, CheckCircle2, XCircle, Layers } from "lucide-react";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { cn } from "@/lib/utils";
import type { Forma, Pt } from "@/components/calibrador/Lienzo";
import { ComoFunciona } from "@/components/calibrador/ComoFunciona";
import { CapaEnVivo, ListaEnVivo, PilaCapturas, useLecturasVivas, type LecturaViva } from "@/components/calibrador/EnVivo";
import { BotonPanel, Deslizador, Pildoras, Seccion, TarjetaElemento, Vacio, type HerramientaDock, type Modulo } from "@/components/calibrador/piezas";

/**
 * Módulo «Lectura» del calibrador único, para las cámaras que lee OmniVision (LPR interior y LPR
 * de acceso sin ANPR) (26/11). Junta lo que antes eran dos pantallas:
 *
 *  · el calibrador de lectura: qué dispara la lectura, la zona de interés (el recorte que se le
 *    manda al lector), la línea de disparo de la cámara, confianza, cuadros por segundo y
 *    sensibilidad de escena, y «Leer ahora»;
 *  · los carriles, zonas de captura y líneas de cruce (lib-geometria-lpr.js), con el rebote.
 *
 * Se guarda todo junto con un solo botón: la calibración (/api/tracking/calibration), la regla
 * de la cámara si el disparo es por línea o zona (/api/tracking/camera-rule) y la geometría
 * (/api/devices/lpr-geometria). Lo que guardaba cada pantalla vieja se guarda igual.
 */
type SentidoCarril = "entra" | "sale" | "ambos";
type SentidoLinea = "ab" | "ba" | "ambos";
type Carril = { id: string; nombre: string; puntos: Pt[]; sentido: SentidoCarril; flecha: { a: Pt; b: Pt } | null };
type Zona = { id: string; nombre: string; puntos: Pt[] };
type LineaG = { id: string; nombre: string; a: Pt; b: Pt; sentido: SentidoLinea };
type Geo = { v: 1; activa: boolean; rebote: number; carriles: Carril[]; zonas: Zona[]; lineas: LineaG[] };
type Roi = { x: number; y: number; w: number; h: number };
type LineaDisparo = { x1: number; y1: number; x2: number; y2: number; sentido: "any" | "left-right" | "right-left" };
type ModoDisparo = "escena" | "zona" | "linea" | "omnivision";
type Estado = { escena: number; confianza: number; fps: number; roi: Roi; linea: LineaDisparo | null; geo: Geo };

export const COLOR_LECTURA = { entra: "#34d399", sale: "#fb923c", ambos: "#38bdf8", zona: "#facc15", linea: "#f472b6", recorte: "#60a5fa", disparo: "#e2e8f0" } as const;
const ROI_TODO: Roi = { x: 0, y: 0, w: 1, h: 1 };
const GEO_VACIA: Geo = { v: 1, activa: true, rebote: 30, carriles: [], zonas: [], lineas: [] };
const esTodo = (r: Roi) => r.x < 0.01 && r.y < 0.01 && r.w > 0.99 && r.h > 0.99;
const nid = (p: string) => `${p}${Math.random().toString(36).slice(2, 7)}`;
const centroide = (ps: Pt[]) => ({ x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length });
/** La flecha por defecto de un carril: vertical por su centro, hacia arriba (el auto se aleja de la cámara). */
const flechaDe = (ps: Pt[]) => { const c = centroide(ps); const ys = ps.map((p) => p.y); const h = (Math.max(...ys) - Math.min(...ys)) * 0.32; return { a: { x: c.x, y: Math.min(1, c.y + h) }, b: { x: c.x, y: Math.max(0, c.y - h) } }; };

const MODOS: { id: ModoDisparo; t: string; d: string; icono: typeof Minus }[] = [
    { id: "omnivision", t: "Cuando OmniVision ve un vehículo", d: "Arranca cuando OmniVision abre la pista de un auto, moto o camión. No se despierta con sombras ni ramas y los estacionados no disparan.", icono: Sparkles },
    { id: "linea", t: "Al cruzar la línea de la cámara", d: "La cámara avisa en el instante del cruce: la lectura queda centrada en el paso. Necesita analítica en la cámara.", icono: Minus },
    { id: "zona", t: "Al entrar en la zona de la cámara", d: "La cámara avisa mientras haya un vehículo en la zona. Un auto quieto vuelve a disparar. Necesita analítica en la cámara.", icono: Square },
    { id: "escena", t: "Por cambio de imagen", d: "Lo decide el servidor mirando si la imagen cambió. Anda con cualquier cámara, pero se despierta con sombras: pide un buen recorte.", icono: Gauge },
];

export function useLecturaOmni(deviceId: string, activo: boolean, equipo?: { direction: string; trackAcceso: boolean } | null): Modulo {
    // Las lecturas en vivo (components/calibrador/EnVivo): prendidas por defecto, no gastan GPU.
    const [verVivo, setVerVivo] = useState(true);
    const vivo = useLecturasVivas(deviceId, activo && verVivo);
    const [resaltada, setResaltada] = useState<LecturaViva | null>(null);
    const [estado, setEstado] = useState<Estado | null>(null);
    const [original, setOriginal] = useState("");
    const [modo, setModo] = useState<ModoDisparo>("escena");
    const [regla, setRegla] = useState<{ soportaLinea?: boolean; soportaZona?: boolean; enVision?: boolean; lineaActiva?: boolean; lineaCamara?: LineaDisparo | null } | null>(null);
    const [lineaCamaraOriginal, setLineaCamaraOriginal] = useState<string | null>(null);
    const [puntos, setPuntos] = useState<{ x: number; y: number; quieto: boolean }[]>([]);
    const [verPuntos, setVerPuntos] = useState(true);
    const [seleccion, setSeleccion] = useState<string | null>(null);
    const [herramienta, setHerramienta] = useState<string | null>(null);
    /** El carril al que se le está dibujando la flecha a mano. */
    const [flechaPara, setFlechaPara] = useState<string | null>(null);
    const [guardando, setGuardando] = useState(false);
    const [aplicandoModo, setAplicandoModo] = useState(false);
    const [leyendo, setLeyendo] = useState(false);
    const [lectura, setLectura] = useState<{ lecturas?: { plate: string; confidence: number }[]; errorLpr?: string } | null>(null);

    const cargar = useCallback(async () => {
        try {
            const [c, r, g] = await Promise.all([
                axios.get(`/api/tracking/calibration?deviceId=${deviceId}`).then((x) => x.data).catch(() => ({})),
                axios.get(`/api/tracking/camera-rule?deviceId=${deviceId}`).then((x) => x.data).catch(() => ({ soportada: false })),
                fetch(`/api/devices/lpr-geometria?deviceId=${encodeURIComponent(deviceId)}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null),
            ]);
            // La línea que la cámara tiene puesta manda sobre la guardada (la de intrusión es la misma regla).
            const linea: LineaDisparo | null = r?.lineaActiva && r?.lineaCamara ? r.lineaCamara : c?.linea || null;
            const e: Estado = { escena: c?.escena ?? 0.08, confianza: c?.confianza ?? 0.6, fps: c?.fps ?? 2, roi: c?.roi || ROI_TODO, linea, geo: g?.ok ? g.geometria : GEO_VACIA };
            setEstado(e); setOriginal(JSON.stringify(e)); setModo(c?.modo || "escena");
            setRegla(r || null); setLineaCamaraOriginal(r?.lineaActiva && r?.lineaCamara ? JSON.stringify(r.lineaCamara) : null);
            setPuntos(g?.puntos || []);
            setSeleccion(null); setHerramienta(null);
        } catch { toast.error({ title: "No se pudo leer la calibración de lectura" }); }
    }, [deviceId]);
    useEffect(() => { if (!activo) return; const t = setTimeout(cargar, 0); return () => clearTimeout(t); }, [activo, cargar]);

    const cambiar = (f: (e: Estado) => Estado) => setEstado((e) => (e ? f(structuredClone(e)) : e));
    const cambiarGeo = (f: (g: Geo) => void) => cambiar((e) => { f(e.geo); return e; });

    // ── Lo dibujado, como formas del lienzo ──
    const formas: Forma[] = useMemo(() => {
        if (!estado) return [];
        const g = estado.geo;
        const off = !g.activa;
        const out: Forma[] = [];
        if (!esTodo(estado.roi)) out.push({ id: "roi", tipo: "rect", puntos: [{ x: estado.roi.x, y: estado.roi.y }, { x: estado.roi.x + estado.roi.w, y: estado.roi.y + estado.roi.h }], color: COLOR_LECTURA.recorte, etiqueta: "Recorte" });
        if (estado.linea) out.push({ id: "disparo", tipo: "linea", puntos: [{ x: estado.linea.x1, y: estado.linea.y1 }, { x: estado.linea.x2, y: estado.linea.y2 }], color: COLOR_LECTURA.disparo, etiqueta: "Disparo de la cámara", sentido: estado.linea.sentido === "left-right" ? "ab" : estado.linea.sentido === "right-left" ? "ba" : undefined, apagada: modo !== "linea" });
        for (const z of g.zonas) out.push({ id: z.id, tipo: "poligono", puntos: z.puntos, color: COLOR_LECTURA.zona, etiqueta: z.nombre, apagada: off });
        for (const c of g.carriles) out.push({ id: c.id, tipo: "poligono", puntos: c.puntos, color: COLOR_LECTURA[c.sentido], etiqueta: c.nombre, flecha: c.flecha, flechaDoble: c.sentido === "ambos", apagada: off });
        for (const l of g.lineas) out.push({ id: l.id, tipo: "linea", puntos: [l.a, l.b], color: COLOR_LECTURA.linea, etiqueta: l.nombre, sentido: l.sentido, apagada: off });
        return out;
    }, [estado, modo]);

    const alCrear = (tipo: "poligono" | "linea" | "rect", pts: Pt[]) => {
        if (!estado) return;
        const k = herramienta;
        if (k === "carril" && tipo === "poligono") { const c: Carril = { id: nid("c"), nombre: `Carril ${estado.geo.carriles.length + 1}`, puntos: pts, sentido: "entra", flecha: flechaDe(pts) }; cambiarGeo((g) => { g.carriles.push(c); }); setSeleccion(c.id); }
        else if (k === "zona" && tipo === "poligono") { const z: Zona = { id: nid("z"), nombre: `Zona ${estado.geo.zonas.length + 1}`, puntos: pts }; cambiarGeo((g) => { g.zonas.push(z); }); setSeleccion(z.id); }
        else if (k === "linea" && tipo === "linea") { const l: LineaG = { id: nid("l"), nombre: `Cruce ${estado.geo.lineas.length + 1}`, a: pts[0], b: pts[1], sentido: "ab" }; cambiarGeo((g) => { g.lineas.push(l); }); setSeleccion(l.id); }
        else if (k === "recorte" && tipo === "rect") { cambiar((e) => ({ ...e, roi: { x: pts[0].x, y: pts[0].y, w: pts[1].x - pts[0].x, h: pts[1].y - pts[0].y } })); setSeleccion("roi"); }
        else if (k === "flecha" && tipo === "linea") {
            // La flecha dibujada a mano: del primer clic al segundo, en el sentido que sea.
            const id = flechaPara; cambiarGeo((g) => { const c = g.carriles.find((x) => x.id === id); if (c) c.flecha = { a: pts[0], b: pts[1] }; }); if (id) setSeleccion(id);
        }
        else if (k === "disparo" && tipo === "linea") { cambiar((e) => ({ ...e, linea: { x1: pts[0].x, y1: pts[0].y, x2: pts[1].x, y2: pts[1].y, sentido: e.linea?.sentido || "any" } })); setSeleccion("disparo"); }
        setHerramienta(null);
    };
    const alCambiar = (id: string, c: { puntos?: Pt[]; flecha?: { a: Pt; b: Pt } | null }) => cambiar((e) => {
        if (id === "roi" && c.puntos) { const [a, b] = c.puntos; e.roi = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }; }
        else if (id === "disparo" && c.puntos && e.linea) { e.linea = { ...e.linea, x1: c.puntos[0].x, y1: c.puntos[0].y, x2: c.puntos[1].x, y2: c.puntos[1].y }; }
        else {
            const car = e.geo.carriles.find((x) => x.id === id); if (car) { if (c.puntos) car.puntos = c.puntos; if (c.flecha !== undefined) car.flecha = c.flecha; }
            const z = e.geo.zonas.find((x) => x.id === id); if (z && c.puntos) z.puntos = c.puntos;
            const l = e.geo.lineas.find((x) => x.id === id); if (l && c.puntos) { l.a = c.puntos[0]; l.b = c.puntos[1]; }
        }
        return e;
    });
    const alBorrar = (id: string) => {
        cambiar((e) => {
            if (id === "roi") e.roi = ROI_TODO;
            else if (id === "disparo") e.linea = null;
            else { e.geo.carriles = e.geo.carriles.filter((x) => x.id !== id); e.geo.zonas = e.geo.zonas.filter((x) => x.id !== id); e.geo.lineas = e.geo.lineas.filter((x) => x.id !== id); }
            return e;
        });
        setSeleccion(null);
    };

    const cambiarModo = async (m: ModoDisparo) => {
        if (!estado) return;
        setAplicandoModo(true);
        try { await axios.post("/api/tracking/camera-rule", { deviceId, modo: m, linea: m === "linea" ? estado.linea : undefined }); setModo(m); toast.success({ title: "Disparo cambiado", description: MODOS.find((x) => x.id === m)?.t }); }
        catch (e) { toast.error({ title: (e as { response?: { data?: { error?: string } } })?.response?.data?.error || "La cámara no aceptó el cambio" }); }
        finally { setAplicandoModo(false); }
    };

    const leer = async () => {
        if (!estado) return;
        setLeyendo(true);
        try { setLectura((await axios.post("/api/tracking/frame", { deviceId, leer: true, roi: estado.roi })).data); }
        catch (e) { toast.error({ title: (e as { response?: { data?: { error?: string } } })?.response?.data?.error || "No se pudo leer" }); }
        finally { setLeyendo(false); }
    };

    const guardar = async () => {
        if (!estado) return;
        setGuardando(true);
        try {
            await axios.put("/api/tracking/calibration", { deviceId, escena: estado.escena, confianza: estado.confianza, fps: estado.fps, roi: estado.roi, linea: estado.linea });
            if (modo === "zona" || modo === "linea") await axios.post("/api/tracking/camera-rule", { deviceId, modo, linea: modo === "linea" ? estado.linea : undefined });
            // La línea que la cámara ya tenía: borrada acá → se apaga en la cámara; movida → se mueve.
            if (lineaCamaraOriginal && modo !== "linea") {
                if (!estado.linea) await axios.post("/api/tracking/camera-rule", { deviceId, lineaCamara: "quitar" });
                else if (JSON.stringify(estado.linea) !== lineaCamaraOriginal) await axios.post("/api/tracking/camera-rule", { deviceId, lineaCamara: "poner", linea: estado.linea });
            }
            const g = await fetch(`/api/devices/lpr-geometria?deviceId=${encodeURIComponent(deviceId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ geometria: estado.geo }) }).then((r) => r.json());
            if (!g?.ok) throw new Error(g?.error || "No se guardaron los carriles");
            const nuevo = { ...estado, geo: g.geometria };
            setEstado(nuevo); setOriginal(JSON.stringify(nuevo));
            toast.success({ title: "Lectura guardada", description: "OmniVision la toma en menos de un minuto." });
        } catch (e) { toast.error({ title: "No se pudo guardar", description: (e as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error || (e as Error)?.message }); }
        finally { setGuardando(false); }
    };

    const g = estado?.geo;
    const elegido = useMemo(() => {
        if (!estado || !seleccion) return null;
        if (seleccion === "roi") return { tipo: "recorte" as const };
        if (seleccion === "disparo") return { tipo: "disparo" as const };
        const c = estado.geo.carriles.find((x) => x.id === seleccion); if (c) return { tipo: "carril" as const, c };
        const z = estado.geo.zonas.find((x) => x.id === seleccion); if (z) return { tipo: "zona" as const, z };
        const l = estado.geo.lineas.find((x) => x.id === seleccion); if (l) return { tipo: "linea" as const, l };
        return null;
    }, [estado, seleccion]);
    const renombrar = (nombre: string) => cambiarGeo((gg) => { const it = [...gg.carriles, ...gg.zonas, ...gg.lineas].find((x) => x.id === seleccion); if (it) it.nombre = nombre.slice(0, 40); });
    const mejor = lectura?.lecturas?.[0];

    const dock: HerramientaDock[] = [
        { key: "carril", label: "Carril", icono: Route, color: COLOR_LECTURA.entra, herramienta: { tipo: "poligono" as const, color: COLOR_LECTURA.entra, nombre: "Carril" }, ayuda: "Una mano de la calle, con la flecha de hacia dónde va el auto. «Entra» o «Sale» dicen el sentido de la lectura; uno de contramano no cuenta." },
        { key: "zona", label: "Zona", icono: Square, color: COLOR_LECTURA.zona, herramienta: { tipo: "poligono" as const, color: COLOR_LECTURA.zona, nombre: "Zona de captura" }, ayuda: "Sólo cuentan las chapas que caen adentro. Para dejar afuera la vereda, el estacionamiento o la calle de al lado." },
        { key: "linea", label: "Línea", icono: Minus, color: COLOR_LECTURA.linea, herramienta: { tipo: "linea" as const, color: COLOR_LECTURA.linea, nombre: "Línea de cruce" }, ayuda: "Una línea que el auto cruza, con sentido A→B o B→A. Cuenta lo que pasa cerca de ella en ese sentido." },
        { key: "recorte", label: "Recorte", icono: Crop, color: COLOR_LECTURA.recorte, herramienta: { tipo: "rect" as const, color: COLOR_LECTURA.recorte, nombre: "Recorte del cuadro" }, ayuda: "La parte del cuadro que se le manda al lector: la chapa le llega con más detalle. Dejá afuera el cielo y las paredes." },
        { key: "disparo", label: "Disparo", icono: Crosshair, color: "var(--foreground)", herramienta: { tipo: "linea" as const, color: COLOR_LECTURA.disparo, nombre: "Línea de disparo de la cámara" }, deshabilitado: regla?.soportaLinea ? false : "La cámara no tiene cruce de línea", ayuda: "La línea que la propia cámara vigila para avisar que pasó un auto (disparo «al cruzar la línea»)." },
        { key: "leer", label: leyendo ? "Leyendo…" : "Leer ahora", icono: ScanLine, color: "var(--foreground)", accion: leer, deshabilitado: leyendo ? "Leyendo…" : false, ayuda: "Una captura, una lectura: para confirmar que la chapa se lee con el recorte de ahora." },
    ];

    const panel = !estado || !g ? <div className="flex items-center gap-2 p-5 text-[12.5px] text-foreground/60"><Loader2 size={14} className="animate-spin" /> Leyendo la calibración…</div> : (<>
        <Seccion titulo="En vivo" icono={Eye} ayuda="Las lecturas que hace OmniVision con esta cámara, apenas pasan: la caja sigue a la chapa y dice qué carril la tomó, o por qué no.">
            <ListaEnVivo lecturas={vivo.lecturas.filter((l) => !l.historica)} conectado={vivo.conectado} activo={verVivo} cambiar={setVerVivo} />
        </Seccion>

        <Seccion titulo="Dónde leer" icono={Layers} ayuda="Lo dibujado sobre la imagen. Tocá un elemento para ajustarlo; las herramientas están abajo de la escena."
            accion={<button type="button" onClick={() => setVerPuntos((v) => !v)} title="Dónde se leyeron chapas en las últimas 48 h" className="inline-flex h-6 items-center gap-1 rounded-full bg-foreground/[0.06] px-2 text-[10.5px] font-semibold text-foreground/70 hover:bg-foreground/[0.12]">{verPuntos ? <EyeOff size={11} /> : <Eye size={11} />} lecturas {puntos.length}</button>}>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-[10px] bg-foreground/[0.04] px-3 py-2.5">
                <input type="checkbox" checked={g.activa} onChange={(e) => cambiarGeo((gg) => { gg.activa = e.target.checked; })} className="h-4 w-4 accent-emerald-500" />
                <span className="min-w-0">
                    <span className="block text-[12.5px] font-semibold text-foreground">Usar carriles, zonas y líneas</span>
                    <span className="block text-[11px] text-foreground/50">{g.activa ? "Con algo dibujado, OmniVision lee sólo eso." : "Apagado: lee todo el recorte, como antes."}</span>
                </span>
            </label>
            {/* Un carril «Entra»/«Sale» marca la entrada o la salida sólo en una cámara de acceso (tracking-worker). */}
            {g.carriles.some((c) => c.sentido !== "ambos") && equipo && !(equipo.trackAcceso && (equipo.direction === "ENTRY" || equipo.direction === "EXIT")) && (
                <p className="rounded-[10px] border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2.5 text-[11.5px] leading-snug text-amber-800 dark:text-amber-100/90">
                    Esta cámara está como <b>{equipo.direction === "INTERIOR" ? "Interior" : "seguimiento"}</b>: los carriles con sentido descartan los de contramano, pero <b>no</b> marcan entradas ni salidas. Para que cuenten, en su ficha poné el sentido en Entrada o Salida (cualquiera de los dos: cada carril manda en lo suyo).
                </p>
            )}
            {g.carriles.length + g.zonas.length + g.lineas.length === 0 && esTodo(estado.roi) && !estado.linea
                ? <Vacio>Todavía no hay nada dibujado: OmniVision lee todo el cuadro. Elegí <b className="text-foreground/80">Carril</b>, <b className="text-foreground/80">Zona</b> o <b className="text-foreground/80">Línea</b> abajo y tocá sobre la imagen. Los puntos blancos son donde se leyeron chapas: dibujá encima.</Vacio>
                : (
                    <div className="space-y-0.5">
                        {g.carriles.map((c) => <TarjetaElemento key={c.id} color={COLOR_LECTURA[c.sentido]} nombre={c.nombre} detalle={`Carril · ${c.sentido === "entra" ? "entra" : c.sentido === "sale" ? "sale" : "dos manos"}`} elegido={seleccion === c.id} apagado={!g.activa} alElegir={() => setSeleccion(c.id)} />)}
                        {g.zonas.map((z) => <TarjetaElemento key={z.id} color={COLOR_LECTURA.zona} nombre={z.nombre} detalle={`Zona de captura · ${z.puntos.length} vértices`} elegido={seleccion === z.id} apagado={!g.activa} alElegir={() => setSeleccion(z.id)} />)}
                        {g.lineas.map((l) => <TarjetaElemento key={l.id} color={COLOR_LECTURA.linea} nombre={l.nombre} detalle={`Línea de cruce · ${l.sentido === "ab" ? "A→B" : l.sentido === "ba" ? "B→A" : "ambos sentidos"}`} elegido={seleccion === l.id} apagado={!g.activa} alElegir={() => setSeleccion(l.id)} />)}
                        {!esTodo(estado.roi) && <TarjetaElemento color={COLOR_LECTURA.recorte} nombre="Recorte del cuadro" detalle={`${Math.round(estado.roi.w * 100)} × ${Math.round(estado.roi.h * 100)} % del cuadro`} elegido={seleccion === "roi"} alElegir={() => setSeleccion("roi")} />}
                        {estado.linea && <TarjetaElemento color="var(--foreground)" nombre="Disparo de la cámara" detalle={modo === "linea" ? "dispara la lectura" : "puesta, sin usar como disparo"} elegido={seleccion === "disparo"} apagado={modo !== "linea"} alElegir={() => setSeleccion("disparo")} />}
                    </div>
                )}

            {elegido && (
                <div className="space-y-2.5 rounded-[10px] border border-foreground/10 bg-foreground/[0.04] p-3">
                    {(elegido.tipo === "carril" || elegido.tipo === "zona" || elegido.tipo === "linea") && (
                        <input value={(elegido.tipo === "carril" ? elegido.c : elegido.tipo === "zona" ? elegido.z : elegido.l).nombre} onChange={(e) => renombrar(e.target.value)}
                            className="h-8 w-full rounded-[6px] border border-foreground/15 bg-foreground/[0.04] px-2.5 text-[12.5px] font-semibold text-foreground outline-none focus:border-emerald-400" />
                    )}
                    {elegido.tipo === "carril" && (<>
                        <Pildoras valor={elegido.c.sentido} color={COLOR_LECTURA[elegido.c.sentido]} cambiar={(s) => cambiarGeo((gg) => { const c = gg.carriles.find((x) => x.id === seleccion); if (c) { c.sentido = s; if (!c.flecha) c.flecha = flechaDe(c.puntos); } })}
                            opciones={[{ v: "entra", t: "Entra" }, { v: "sale", t: "Sale" }, { v: "ambos", t: "Dos manos" }]} />
                        <div className="grid grid-cols-2 gap-1.5">
                            <BotonPanel onClick={() => { setFlechaPara(seleccion); setHerramienta("flecha"); }}><MoveUpRight size={13} /> Dibujar la flecha</BotonPanel>
                            <BotonPanel onClick={() => cambiarGeo((gg) => { const c = gg.carriles.find((x) => x.id === seleccion); if (c) c.flecha = c.flecha ? { a: c.flecha.b, b: c.flecha.a } : flechaDe(c.puntos); })}><ArrowUpDown size={13} /> Invertir</BotonPanel>
                        </div>
                        <p className="text-[11px] leading-snug text-foreground/50">{herramienta === "flecha" ? "Clic donde arranca el auto y clic hacia donde va. Sirve en cualquier sentido." : elegido.c.sentido === "ambos" ? "Dos manos: la flecha va y viene y no se descarta ningún sentido. Para separar entradas de salidas, dibujá un carril por mano." : "La flecha es hacia dónde va el auto: dibujala con dos clics o arrastrá sus puntas. «Entra» y «Sale» dicen el sentido de la lectura; uno de contramano no cuenta."}</p>
                    </>)}
                    {elegido.tipo === "linea" && (<>
                        <Pildoras valor={elegido.l.sentido} color={COLOR_LECTURA.linea} cambiar={(s) => cambiarGeo((gg) => { const l = gg.lineas.find((x) => x.id === seleccion); if (l) l.sentido = s; })}
                            opciones={[{ v: "ab", t: "A → B" }, { v: "ba", t: "B → A" }, { v: "ambos", t: "Ambos" }]} />
                        <p className="text-[11px] leading-snug text-foreground/50">La flecha blanca del medio es el cruce que cuenta.</p>
                    </>)}
                    {elegido.tipo === "disparo" && estado.linea && (<>
                        <Pildoras valor={estado.linea.sentido} cambiar={(s) => cambiar((e) => { if (e.linea) e.linea.sentido = s; return e; })}
                            opciones={[{ v: "left-right", t: "Izq → der" }, { v: "right-left", t: "Der → izq" }, { v: "any", t: "Ambos" }]} />
                        <p className="text-[11px] leading-snug text-foreground/50">{regla?.lineaActiva ? "Es la línea que la cámara tiene puesta: moverla o borrarla la cambia en la cámara al guardar." : "Se escribe en la cámara si el disparo es «al cruzar la línea»."}</p>
                    </>)}
                    {elegido.tipo === "recorte" && <p className="text-[11px] leading-snug text-foreground/50">Lo de afuera no se lee. Arrastrá las esquinas; Supr vuelve a todo el cuadro.</p>}
                    {elegido.tipo === "zona" && <p className="text-[11px] leading-snug text-foreground/50">Arrastrá los vértices; el «+» de cada lado agrega uno y doble clic en un vértice lo saca.</p>}
                    <BotonPanel peligro className="w-full" onClick={() => alBorrar(seleccion!)}><Trash2 size={13} /> {elegido.tipo === "recorte" ? "Volver a todo el cuadro" : "Quitar"}</BotonPanel>
                </div>
            )}
        </Seccion>

        <Seccion titulo="Qué dispara la lectura" icono={Waypoints} ayuda="Cuándo se le piden cuadros al lector. Se aplica en el momento.">
            <div className="space-y-1">
                {MODOS.map((m) => {
                    const puede = m.id === "escena" ? true : m.id === "omnivision" ? !!regla?.enVision : m.id === "linea" ? !!regla?.soportaLinea && !!estado.linea : !!regla?.soportaZona;
                    const motivo = m.id === "omnivision" ? "la cámara no está en el análisis de OmniVision" : m.id === "linea" ? (regla?.soportaLinea ? "dibujá la línea de disparo" : "la cámara no tiene cruce de línea") : "la cámara no tiene detección de zona";
                    const on = modo === m.id;
                    return (
                        <button key={m.id} type="button" disabled={!puede || aplicandoModo} onClick={() => !on && cambiarModo(m.id)} title={puede ? m.d : `No disponible: ${motivo}`}
                            className={cn("flex w-full items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-left transition-colors", on ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_14%,transparent)]" : "border-foreground/[0.06] hover:bg-foreground/[0.05]", !puede && "opacity-40")}>
                            <m.icono size={15} className={cn("mt-0.5 shrink-0", on ? "text-sky-600 dark:text-sky-300" : "text-foreground/50")} />
                            <span className="min-w-0">
                                <span className="block text-[12.5px] font-semibold text-foreground">{m.t}</span>
                                <span className="block text-[11px] leading-snug text-foreground/45">{puede ? m.d : `No disponible: ${motivo}.`}</span>
                            </span>
                            {on && aplicandoModo && <Loader2 size={13} className="ml-auto animate-spin" />}
                        </button>
                    );
                })}
            </div>
        </Seccion>

        <Seccion titulo="Así va a funcionar" icono={ListOrdered} ayuda="El disparo, el filtro y la foto, en el orden en que pasan. Se arma con lo que está en pantalla, guardado o no.">
            <ComoFunciona deviceId={deviceId} activo={activo} r={{
                modo, fps: estado.fps, confianza: estado.confianza, rebote: g.rebote, recorte: !esTodo(estado.roi), activa: g.activa,
                carriles: g.carriles.map((c) => ({ nombre: c.nombre, sentido: c.sentido })), lineas: g.lineas.map((l) => ({ nombre: l.nombre, sentido: l.sentido })), zonas: g.zonas.map((z) => ({ nombre: z.nombre })),
                lineaCamara: estado.linea?.sentido || null, marcaSentido: !!equipo?.trackAcceso && (equipo.direction === "ENTRY" || equipo.direction === "EXIT"),
            }} />
        </Seccion>

        <Seccion titulo="Ajustes del lector" icono={Gauge}>
            <Deslizador etiqueta="Confianza mínima" valor={estado.confianza} min={0.3} max={0.95} paso={0.05} formato={(v) => `${Math.round(v * 100)} %`} cambiar={(v) => cambiar((e) => ({ ...e, confianza: v }))}
                ayuda="Por debajo de esto la lectura se descarta. Subilo si aparecen chapas inventadas; bajalo si descarta lecturas buenas." color="#34d399" />
            <Deslizador etiqueta="Cuadros por segundo" valor={estado.fps} min={1} max={8} paso={1} formato={(v) => `${v} c/s`} cambiar={(v) => cambiar((e) => ({ ...e, fps: v }))}
                ayuda="Más cuadros por ráfaga, más chances de agarrar la chapa de frente, a costa de más GPU." />
            {modo === "escena" && <Deslizador etiqueta="Sensibilidad de escena" valor={estado.escena} min={0.02} max={0.3} paso={0.01} formato={(v) => v.toFixed(2)} cambiar={(v) => cambiar((e) => ({ ...e, escena: v }))}
                ayuda="Cuánto tiene que cambiar la imagen para mandar un cuadro al lector. Más bajo, más lecturas y más GPU." color="#facc15" />}
            <Deslizador etiqueta="Rebote" valor={g.rebote} min={0} max={120} paso={5} formato={(v) => (v ? `${v} s` : "apagado")} cambiar={(v) => cambiarGeo((gg) => { gg.rebote = v; })}
                ayuda="La misma chapa en el mismo carril, zona o línea dentro de estos segundos se descarta: es el mismo auto en dos ráfagas seguidas." color="#a78bfa" />
        </Seccion>

        {lectura && (
            <Seccion titulo="Última lectura" icono={Timer}>
                {mejor ? (
                    <div className="flex items-center gap-2 rounded-[10px] bg-foreground/[0.05] px-3 py-2.5 text-[12.5px]">
                        {mejor.confidence >= estado.confianza ? <CheckCircle2 size={15} className="text-emerald-600 dark:text-emerald-400" /> : <XCircle size={15} className="text-amber-600 dark:text-amber-400" />}
                        <span className="font-bold tracking-widest tabular-nums text-foreground">{mejor.plate}</span>
                        <span className="tabular-nums text-foreground/60">{Math.round(mejor.confidence * 100)} %</span>
                        <span className="text-foreground/45">{mejor.confidence >= estado.confianza ? "se registraría" : "debajo del mínimo"}</span>
                    </div>
                ) : <Vacio>{lectura.errorLpr || "Ninguna chapa en ese cuadro. Si no pasaba ningún auto, es normal."}</Vacio>}
            </Seccion>
        )}
    </>);

    const capaPuntos = verPuntos && puntos.length > 0 ? (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1000 1000" preserveAspectRatio="none">
            {puntos.map((p, i) => <ellipse key={i} cx={p.x * 1000} cy={p.y * 1000} rx={3.2} ry={5.4} fill={p.quieto ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.75)"} stroke="rgba(0,0,0,0.5)" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />)}
        </svg>
    ) : null;
    const capa = <>{capaPuntos}{verVivo && <CapaEnVivo vivas={vivo.vivas} ahora={vivo.ahora} resaltada={resaltada} />}</>;
    const lateral = verVivo ? <PilaCapturas lecturas={vivo.lecturas} ahora={vivo.ahora} alResaltar={setResaltada} /> : undefined;

    return {
        disponible: true, formas, seleccion, setSeleccion, herramienta, setHerramienta, dock, herramientasPanel: { flecha: { tipo: "linea", color: "#ffffff", nombre: "Flecha del carril", max: 2 } }, alCrear, alCambiar, alBorrar, capa, lateral, panel,
        sucio: !!estado && JSON.stringify(estado) !== original, guardando, guardar, revertir: cargar, rotuloGuardar: "Guardar lectura",
    };
}
