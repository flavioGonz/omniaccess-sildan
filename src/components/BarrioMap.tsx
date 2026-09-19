"use client";

import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
const Mapa3D = dynamic(() => import("@/components/mapa/Mapa3D"), { ssr: false });
import { motion } from "framer-motion";
import { CapaRecorrido, PanelRecorrido, useRecorrido, type Lugar, type Punto } from "@/components/mapa/Recorrido";
import { VisorCuadro } from "@/components/VisorCuadro";
import { MapContainer, TileLayer, Polygon, Polyline, Marker, Popup, Tooltip as LTooltip, Pane, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import {
    MousePointer2, Hexagon, Spline, Video, Trash2, Save, Pencil, X, Check,
    Loader2, MapPin, Undo2, Map as MapIco, Radio, Pencil as PencilIcon,
    Plus, Minus, Crosshair, Maximize2, Minimize2, Eye, EyeOff, ShieldCheck, Route as RouteIco,
    Layers3, ChevronDown, Pentagon, Home, Search, SquareParking, AlertTriangle,
} from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { IconBar } from "@/components/ui/icon-bar";
import { CSS_AUTO } from "@/lib/auto-svg";
import { montarVivo } from "@/lib/vivo";
import { BotonFijar, useVivo } from "@/components/vivo/PanelVivo";
import { sileo as toast } from "sileo";
import { getBarrioMap, saveBarrioMap, type BarrioMapData } from "@/app/actions/barriomap";
import { getParkingSlots } from "@/app/actions/plazas";
import { io } from "socket.io-client";
import { getSocketUrl } from "@/lib/socket-config";
import { FlowAnims, FlowColumn, useFlow } from "@/components/barrio/FlowLayer";
import { LogIn, LogOut } from "lucide-react";
import { getDevices } from "@/app/actions/devices";
import { getUnits } from "@/app/actions/units";

type Tool = "select" | "perimeter" | "street" | "camera" | "lote";
type LL = [number, number];

const camSvg = `
<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-4px)">
  <span class="cam-glyph" style="width:30px;height:30px;border-radius:8px;background:#2563eb;border:2px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 6px rgba(0,0,0,.4)">
    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>
  </span>
</div>`;
const camIcon = L.divIcon({ className: "bg-transparent border-0", html: camSvg, iconSize: [30, 30], iconAnchor: [15, 22], popupAnchor: [0, -20] });

/** Manija de vértice: arrastrar mueve, clic derecho lo quita. */
const verticeHtml = `<span style="display:block;width:12px;height:12px;border-radius:50%;background:#fff;border:2px solid #f59e0b;box-shadow:0 1px 4px rgba(0,0,0,.6)"></span>`;

const guardIconHtml = (name: string, heading?: number | null) => `
<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-2px)">
  <span style="margin-bottom:2px;padding:1px 6px;border-radius:6px;background:rgba(16,185,129,.95);color:#fff;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.4)">${name}</span>
  <span style="position:relative;width:30px;height:30px;border-radius:50%;background:#10b981;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,.45)">
    ${heading != null ? `<span style="position:absolute;top:-9px;left:50%;transform:translateX(-50%) rotate(${Math.round(heading)}deg);transform-origin:50% 24px"><svg width="14" height="14" viewBox="0 0 24 24" fill="#10b981" stroke="#fff" stroke-width="1.5"><path d="M12 2 L19 21 L12 17 L5 21 Z"/></svg></span>` : ``}
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>
  </span>
</div>`;

function MapRefGrabber({ onMap }: { onMap: (m: L.Map) => void }) {
    const map = useMap();
    useEffect(() => { onMap(map); }, [map, onMap]);
    return null;
}
function ClickHandler({ onClick }: { onClick: (ll: LL) => void }) {
    useMapEvents({ click(e) { onClick([e.latlng.lat, e.latlng.lng]); } });
    return null;
}

function LiveMp4({ deviceId }: { deviceId: string }) {
    const ref = useRef<HTMLVideoElement>(null);
    useEffect(() => {
        const v = ref.current;
        if (!v) return;
        return montarVivo(v, deviceId);
    }, [deviceId]);
    return <video ref={ref} muted autoPlay playsInline className="block w-full h-full object-cover bg-black" />;
}

/**
 * Todas las cámaras en vivo, cada una sobre su lugar del mapa.
 *
 * La gracia es ver qué pasa Y dónde al mismo tiempo: un mosaico aparte muestra lo
 * primero pero pierde lo segundo, que en un barrio es la mitad de la información.
 *
 * Las burbujas no son marcadores de Leaflet. Un marcador lleva su contenido a un icono
 * y ahí adentro un <video> se comporta mal; además Leaflet recrea el icono en cada
 * cambio de vista, lo que cortaría el flujo en cada paneo. Acá el video se monta una
 * sola vez y en cada movimiento del mapa se recalcula únicamente su posición.
 */
function BurbujasVivo({ camaras, nombre, onCerrarUna }: {
    camaras: { deviceId: string; lat: number; lng: number }[];
    nombre: (id: string) => string;
    onCerrarUna: (id: string) => void;
}) {
    const map = useMap();
    const [, redibujar] = useReducer((n: number) => n + 1, 0);
    useMapEvents({ move: redibujar, zoom: redibujar, resize: redibujar });
    const { esFija } = useVivo();

    /*
     * Una cámara fijada NO sigue colgando del mapa.
     *
     * Fijar es mover, no duplicar: si la burbuja se quedara además de la ventana flotante
     * habría dos flujos RTSP de la misma cámara andando a la vez — el doble de ancho de
     * banda y el doble de carga en go2rtc, por ver dos veces lo mismo. Y en pantalla serían
     * dos imágenes iguales, una tapando a la otra, sin manera de saber cuál es cuál.
     */
    const utiles = camaras.filter((c) =>
        Number.isFinite(c.lat) && Number.isFinite(c.lng) && !esFija(c.deviceId));
    if (!utiles.length) return null;

    return createPortal(
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 640 }}>
            {utiles.map((c) => {
                let p: L.Point;
                try { p = map.latLngToContainerPoint([c.lat, c.lng]); } catch { return null; }

                // Se mantiene dentro del mapa. Una cámara cerca del borde dejaba la burbuja
                // cortada por la mitad, que es justo cuando más falta hace verla entera.
                const tam = map.getSize();
                const MEDIO = 118, ALTO = 168;
                const x = Math.max(MEDIO + 6, Math.min(tam.x - MEDIO - 6, p.x));
                const y = Math.max(ALTO + 6, p.y - 34);
                return (
                    <motion.div
                        key={c.deviceId}
                        initial={{ opacity: 0, scale: 0.9, y: 6 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ type: "spring", stiffness: 420, damping: 32 }}
                        className="absolute pointer-events-auto"
                        /* Se ancla abajo, sobre el distintivo de la cámara, para no taparlo. */
                        style={{ left: x, top: y, transform: "translate(-50%,-100%)" }}
                    >
                        <div className="rounded-xl overflow-hidden border border-white/15 shadow-2xl shadow-black/70 bg-[#0a0d12]">
                            <div className="relative w-[224px] h-[126px]">
                                <LiveMp4 deviceId={c.deviceId} />
                            </div>
                            <div className="px-2 py-1 bg-black/85 flex items-center gap-1.5">
                                <Radio size={10} className="text-red-400 shrink-0 animate-pulse" />
                                <span className="text-[11px] font-bold text-white truncate">{nombre(c.deviceId)}</span>
                                {/* Fijar: la saca del mapa y la deja en pantalla, abierta,
                                    aunque se cambie de página. Es la diferencia entre mirar
                                    dónde pasa algo y dejar una cámara puesta mientras se
                                    trabaja en otra cosa. */}
                                <span className="ml-auto flex items-center gap-0.5 shrink-0">
                                    <BotonFijar deviceId={c.deviceId} nombre={nombre(c.deviceId)} />
                                    <button onClick={() => onCerrarUna(c.deviceId)}
                                        title="Ocultar esta cámara"
                                        className="w-5 h-5 rounded text-white/45 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors">
                                        <X size={11} />
                                    </button>
                                </span>
                            </div>
                        </div>
                        {/* Pico que la ata al marcador de abajo. Si hubo que correr la
                            burbuja para que entrara, el pico apuntaría a cualquier lado. */}
                        {Math.abs(x - p.x) < 2 && (
                            <span className="block mx-auto w-2 h-2 rotate-45 -mt-1 bg-black/85 border-r border-b border-white/15" />
                        )}
                    </motion.div>
                );
            })}
        </div>,
        map.getContainer(),
    );
}

export default function BarrioMap() {
    const [data, setData] = useState<BarrioMapData | null>(null);
    // Capa base elegida: define el tratamiento de color del mapa.
    const [base, setBase] = useState<string>("Híbrido");
    const [vista3D, setVista3D] = useState(false);
    const rec = useRecorrido();
    const [cuadroRecorrido, setCuadroRecorrido] = useState<Punto | null>(null);
    const [devices, setDevices] = useState<any[]>([]);
    const [editing, setEditing] = useState(false);
    const [tool, setTool] = useState<Tool>("select");
    const [draftPerimeter, setDraftPerimeter] = useState<LL[]>([]);
    const [draftStreet, setDraftStreet] = useState<LL[]>([]);
    const [draftLote, setDraftLote] = useState<LL[]>([]);
    const [asignando, setAsignando] = useState<{ id: string; que: "unidad" | "plaza" } | null>(null);
    const [unidades, setUnidades] = useState<any[]>([]);
    const [plazas, setPlazas] = useState<any[]>([]);
    /**
     * Si hay dibujo sin guardar.
     *
     * Acá estaba el problema que hacía perder lotes. Cerrar un contorno lo agregaba al
     * estado local y lo dibujaba en el mapa — o sea: en pantalla ya estaba, y el botón
     * decía "Cerrar", que suena a terminado. Pero el mapa entero se guarda de una sola vez
     * en un ajuste, y eso pasa recién al apretar "Guardar". El operador dibujaba, veía su
     * lote, y se iba. Nada le decía que faltaba un paso.
     *
     * No se autoguarda: el mapa es un todo — perímetro, calles, cámaras, lotes y vista —
     * y guardar solo porque se cerró un polígono subiría también lo que quedó a medias.
     * Lo que faltaba no era guardar solo: era AVISAR.
     */
    const [sinGuardar, setSinGuardar] = useState(false);
    const router = useRouter();
    /**
     * El lote bajo el puntero.
     *
     * Se guarda con la posición del mouse porque la ficha se dibuja al lado del cursor y
     * no en una esquina fija: en un mapa la pregunta es siempre "¿de quién es ESTA casa?",
     * y una ficha lejos del polígono obliga a mirar dos lugares y recordar cuál se estaba
     * señalando.
     */
    const [hoverLote, setHoverLote] = useState<{ id: string; x: number; y: number } | null>(null);
    const [buscaUnidad, setBuscaUnidad] = useState("");
    const [pendingCam, setPendingCam] = useState<string>("");
    const [selected, setSelected] = useState<{ type: "street" | "camera" | "lote"; id: string } | null>(null);
    const [saving, setSaving] = useState(false);
    const [ctx, setCtx] = useState<{ x: number; y: number; type: "street" | "camera" | "lote"; id: string } | null>(null);
    const mapRef = useRef<L.Map | null>(null);
    const [guards, setGuards] = useState<any[]>([]);
    // Usabilidad: capas que se pueden apagar y pantalla completa.
    const [verCapa, setVerCapa] = useState({ camaras: true, calles: true, lotes: true, perimetro: true, guardias: true });
    // Vivo de todas las cámaras a la vez. `ocultas` deja apagar una sin apagar el resto.
    const [vivoTodas, setVivoTodas] = useState(false);
    // Cómo quedó la vista 3D. En un ref y no en estado: cambia en cada paneo y solo
    // se lee al guardar, así que no hace falta redibujar por esto.
    const vista3DRef = useRef<{ center: [number, number]; zoom: number; pitch: number; bearing: number } | null>(null);
    const [ocultas, setOcultas] = useState<string[]>([]);
    const [menuCapas, setMenuCapas] = useState(false);
    const [ayuda3D, setAyuda3D] = useState(false);
    const [pantallaCompleta, setPantallaCompleta] = useState(false);
    const contenedorRef = useRef<HTMLDivElement | null>(null);
    const [liveSocket, setLiveSocket] = useState<any>(null);

    // GPS de guardias en vivo (tablets PWA /guard) via socket
    useEffect(() => {
        const s = io(window.location.origin, { path: "/io/socket.io", transports: ["polling"], reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000, reconnectionDelayMax: 8000 });
        s.on("guard_locations", (data: any[]) => setGuards(Array.isArray(data) ? data.filter((g) => g.lat != null) : []));
        s.on("connect", () => s.emit("get_guard_locations"));
        setLiveSocket(s);
        const iv = setInterval(() => { if (s.connected) s.emit("get_guard_locations"); }, 30000);
        return () => { clearInterval(iv); setLiveSocket(null); s.disconnect(); };
    }, []);

    useEffect(() => {
        getBarrioMap().then(setData).catch(() => setData(null));
        getDevices().then((d: any) => setDevices((d || []).filter((x: any) => x.deviceType === "LPR_CAMERA" || x.deviceType === "LPR_INTERIOR"))).catch(() => {});
        getUnits().then((u: any) => setUnidades(u || [])).catch(() => { });
        getParkingSlots().then((p: any) => setPlazas(p || [])).catch(() => { });
    }, []);
    /**
     * Avisar antes de cerrar la pestaña con dibujo sin guardar.
     *
     * El navegador sólo deja mostrar su propio cartel — no se puede escribir el texto —,
     * pero alcanza: lo que hacía falta era que alguien PREGUNTE. Un lote dibujado y no
     * guardado se perdía sin una sola señal.
     */
    useEffect(() => {
        if (!sinGuardar) return;
        const avisar = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
        window.addEventListener("beforeunload", avisar);
        return () => window.removeEventListener("beforeunload", avisar);
    }, [sinGuardar]);

    useEffect(() => {
        const close = () => { setCtx(null); setMenuCapas(false); };
        window.addEventListener("click", close);
        return () => window.removeEventListener("click", close);
    }, []);

    // La capa se recuerda: primero la guardada en el mapa (vale para todos),
    // y si no hay, la ultima que eligio este navegador.
    //
    // La vista 3D se restaura UNA sola vez, al llegar el mapa. Si se volviera a aplicar en
    // cada cambio de `data` — y `data` cambia al guardar — el operador no podría salir de
    // la 3D: la sacaría y el efecto se la volvería a poner.
    const restaurada = useRef(false);
    useEffect(() => {
        if (!data) return;
        const guardada = (data as any).base;
        if (guardada) setBase(guardada);
        else { try { const g = localStorage.getItem("omni-mapa-capa"); if (g) setBase(g); } catch { } }
        if (!restaurada.current) {
            restaurada.current = true;
            // La elección de este navegador manda sobre la del mapa guardado.
            //
            // Mirar en 3D o en plano es una preferencia de quien mira, no una propiedad
            // del barrio, y además "Editar mapa" apaga la 3D a propósito (el dibujo se
            // hace en la vista plana). Si solo se recordara al guardar, la única manera de
            // dejar el mapa en 3D sería entrar a editar, volver a ponerla y guardar — que
            // es exactamente lo que no funcionaba. El mapa guardado queda como el valor
            // por defecto, para quien nunca eligió.
            let local: string | null = null;
            try { local = localStorage.getItem("omni-mapa-3d"); } catch { }
            setVista3D(local != null ? local === "1" : (data as any).tresD === true);
        }
    }, [data]);
    useEffect(() => {
        try { localStorage.setItem("omni-mapa-capa", base); } catch { }
    }, [base]);
    useEffect(() => {
        if (!restaurada.current) return;   // no pisar antes de haber restaurado
        try { localStorage.setItem("omni-mapa-3d", vista3D ? "1" : "0"); } catch { }
    }, [vista3D]);

    // Atajos: "/" o Ctrl/Cmd+K enfocan el buscador de abajo (hay uno solo);
    // Esc cierra el menú de capas y el menú contextual.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const enCampo = ["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName || "");
            if ((e.key === "/" && !enCampo) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) {
                e.preventDefault();
                const campo = contenedorRef.current?.querySelector<HTMLInputElement>('input[placeholder^="Matrícula"]');
                campo?.focus();
            }
            if (e.key === "Escape") { setMenuCapas(false); setCtx(null); }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    // La ayuda de la vista 3D se muestra unos segundos y se va sola.
    useEffect(() => {
        if (!vista3D) { setAyuda3D(false); return; }
        setAyuda3D(true);
        const t = setTimeout(() => setAyuda3D(false), 7000);
        return () => clearTimeout(t);
    }, [vista3D]);

    useEffect(() => {
        const onFs = () => setPantallaCompleta(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", onFs);
        return () => document.removeEventListener("fullscreenchange", onFs);
    }, []);

    const devById = useMemo(() => Object.fromEntries(devices.map((d) => [d.id, d])), [devices]);
    // Flujo en vivo (columnas + autitos) — hooks siempre antes del early-return
    const camsNamed = useMemo(() => (data?.cameras || []).map((c) => ({ ...c, name: (devById as any)[c.deviceId]?.name })), [data, devById]);
    const flow = useFlow(data?.streets || [], camsNamed, liveSocket);

    /**
     * Las últimas pasadas que ofrece el buscador con el campo vacío.
     *
     * No sale de ninguna consulta nueva: son las mismas lecturas que ya alimentan las
     * columnas de entradas y salidas, fusionadas y ordenadas por hora.
     *
     * Va ACÁ, antes del `return` de "Cargando mapa…", y no junto al resto de los cálculos
     * de abajo. Ahí estaba, y rompía la pantalla con un React #310: mientras `data` era
     * null el componente salía temprano con N ganchos, y al llegar los datos renderizaba
     * N+1. Un gancho después de un `return` condicional no es un gancho, es una bomba de
     * tiempo que explota justo cuando la pantalla empieza a funcionar.
     */
    const ultimasPasadas = useMemo(() => {
        const todas = [...flow.entries, ...flow.exits];
        return todas
            .filter((e: any) => e.plateDetected)
            .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, 10)
            .map((e: any) => ({
                id: e.id,
                plate: String(e.plateDetected).toUpperCase(),
                camara: e.device?.name || null,
                cuando: e.timestamp,
                sentido: e.direction as any,
            }));
    }, [flow.entries, flow.exits]);
    const placedIds = useMemo(() => new Set((data?.cameras || []).map((c) => c.deviceId)), [data]);
    const unplaced = devices.filter((d) => !placedIds.has(d.id));

    if (!data) return <div className="h-full w-full flex items-center justify-center text-muted-foreground"><Loader2 className="animate-spin mr-2" size={18} /> Cargando mapa…</div>;

    const onMapClick = (ll: LL) => {
        if (!editing) return;
        if (tool === "perimeter") setDraftPerimeter((p) => [...p, ll]);
        else if (tool === "street") setDraftStreet((p) => [...p, ll]);
        else if (tool === "lote") setDraftLote((p) => [...p, ll]);
        else if (tool === "camera") {
            if (!pendingCam) { toast.error({ title: "Elegí una cámara primero" }); return; }
            cambiar((d) => ({ ...d, cameras: [...d.cameras.filter((c) => c.deviceId !== pendingCam), { deviceId: pendingCam, lat: ll[0], lng: ll[1] }] }));
            setPendingCam(""); setTool("select");
        }
    };
    /**
     * Cambiar el mapa es marcarlo como sucio, siempre.
     *
     * Va por acá y no en cada lugar: había once puntos que tocaban `data`, y alcanzaba con
     * olvidarse de uno para que el aviso mintiera — y un aviso que a veces no aparece es
     * peor que ninguno, porque enseña a confiar en él.
     */
    const cambiar = (fn: (d: BarrioMapData) => BarrioMapData) => {
        setSinGuardar(true);
        setData((d) => d ? fn(d) : d);
    };

    const commitPerimeter = () => { if (draftPerimeter.length >= 3) cambiar((d) => ({ ...d, perimeter: draftPerimeter })); setDraftPerimeter([]); setTool("select"); };
    const commitStreet = () => { if (draftStreet.length >= 2) cambiar((d) => ({ ...d, streets: [...d.streets, { id: `s_${Date.now()}`, points: draftStreet }] })); setDraftStreet([]); setTool("select"); };
    const lotes = data.lots || [];
    const commitLote = () => {
        if (draftLote.length >= 3) {
            const nombre = window.prompt("Nombre de la casa o lote:", `Lote ${lotes.length + 1}`);
            cambiar((d) => ({ ...d, lots: [...(d.lots || []), { id: `l_${Date.now()}`, label: (nombre || `Lote ${lotes.length + 1}`).trim(), unitId: null, parkingSlotId: null, points: draftLote }] }));
        }
        setDraftLote([]); setTool("select");
        /*
         * Decirlo en el momento, no al final.
         *
         * "Cerrar" cierra el contorno; el lote todavía vive sólo en la pantalla. El
         * operador acaba de ver aparecer su polígono y da por hecho que quedó — es lo
         * razonable. Este aviso es el que faltaba, y va acá y no en una ayuda general
         * porque el único instante en que sirve es este.
         */
        toast.info({
            title: "Lote dibujado",
            description: "Todavía no está guardado: tocá «Guardar» para que quede en el mapa del barrio.",
        });
    };
    const removeLote = (id: string) => cambiar((d) => ({ ...d, lots: (d.lots || []).filter((l) => l.id !== id) }));
    const renameLote = (id: string) => {
        const actual = lotes.find((l) => l.id === id);
        const n = window.prompt("Nombre de la casa o lote:", actual?.label || "");
        if (n != null) cambiar((d) => ({ ...d, lots: (d.lots || []).map((l) => l.id === id ? { ...l, label: n.trim() } : l) }));
    };
    /**
     * La plaza de estacionamiento del lote.
     *
     * Es otra cosa que la unidad y por eso va aparte: una casa puede tener su cochera del
     * otro lado del barrio, y una plaza puede estar asignada a alguien sin que nadie haya
     * dibujado todavía su lote. Atarlas en un solo campo obligaría a inventar una de las
     * dos cada vez que falta la otra.
     */
    const asignarPlaza = (loteId: string, parkingSlotId: string | null) => {
        cambiar((d) => ({ ...d, lots: (d.lots || []).map((l) => l.id === loteId ? { ...l, parkingSlotId } : l) }));
        setAsignando(null); setBuscaUnidad("");
    };
    const plazaDe = (id?: string | null) => plazas.find((p: any) => p.id === id);
    /** Las matrículas de quienes viven en ese lote, para poder saltar a su historial. */
    const chapasDelLote = (lo?: any): string[] => {
        const uni = unidadDe(lo?.unitId);
        return (uni?.users || []).flatMap((r: any) => (r.vehicles || []).map((v: any) => v.plate)).filter(Boolean);
    };

    const asignarUnidad = (loteId: string, unitId: string | null) => {
        cambiar((d) => ({ ...d, lots: (d.lots || []).map((l) => l.id === loteId ? { ...l, unitId } : l) }));
        setAsignando(null); setBuscaUnidad("");
    };
    const moverVertice = (loteId: string, idx: number, ll: LL) => {
        cambiar((d) => ({ ...d, lots: (d.lots || []).map((l) => l.id === loteId ? { ...l, points: l.points.map((p, i) => i === idx ? ll : p) } : l) }));
    };
    const quitarVertice = (loteId: string, idx: number) => {
        cambiar((d) => ({ ...d, lots: (d.lots || []).map((l) => l.id === loteId && l.points.length > 3 ? { ...l, points: l.points.filter((_, i) => i !== idx) } : l) }));
    };
    /** Unidad asignada a un lote, para el cartel y el panel. */
    const unidadDe = (unitId?: string | null) => unidades.find((u: any) => u.id === unitId);

    const removeCamera = (id: string) => cambiar((d) => ({ ...d, cameras: d.cameras.filter((c) => c.deviceId !== id) }));
    const removeStreet = (id: string) => cambiar((d) => ({ ...d, streets: d.streets.filter((s) => s.id !== id) }));
    const renameStreet = (id: string) => { const n = window.prompt("Nombre de la calle:"); if (n != null) cambiar((d) => ({ ...d, streets: d.streets.map((s) => s.id === id ? { ...s, name: n } : s) })); };

    const deleteSelected = () => {
        if (!selected) return;
        if (selected.type === "camera") removeCamera(selected.id);
        else if (selected.type === "lote") removeLote(selected.id);
        else removeStreet(selected.id);
        setSelected(null);
    };

    const FILTROS: Record<string, string> = {
        "Táctico": "invert(1) hue-rotate(180deg) saturate(0.55) brightness(0.92) contrast(1.06)",
        "Híbrido": "saturate(0.45) contrast(1.22) brightness(0.82)",
        "Satélite": "saturate(0.72) contrast(1.08) brightness(0.94)",
        "Calles": "saturate(0.85)",
    };
    const oscura = base === "Táctico" || base === "Híbrido";

    const save = async () => {
        setSaving(true);
        const m = mapRef.current;
        // Guardamos tambien la capa elegida: al volver, el mapa abre igual a
        // como lo dejo el operador.
        // En 3D el mapa de Leaflet no está montado, así que el centro y el zoom salen de
        // lo que informó la vista 3D. Antes se caía al valor viejo y "Guardar" en 3D
        // parecía no hacer nada.
        const v3 = vista3D ? vista3DRef.current : null;
        const payload: BarrioMapData = {
            ...data,
            center: v3 ? v3.center : m ? [m.getCenter().lat, m.getCenter().lng] : data.center,
            zoom: v3 ? v3.zoom : m ? m.getZoom() : data.zoom,
            base,
            tresD: vista3D,
            ...(v3 ? { pitch: v3.pitch, bearing: v3.bearing } : {}),
        } as BarrioMapData;
        try { const r = await saveBarrioMap(payload); if (r.ok) { toast.success({ title: "Mapa guardado", description: vista3D ? "Abre en vista 3D, con este giro e inclinación" : `Vista, zoom y capa ${base} recordados` }); setData(payload); setSinGuardar(false); setEditing(false); setTool("select"); } else toast.error({ title: "Error al guardar", description: r.error || "sin detalle" }); }
        catch (e: any) { toast.error({ title: "Error al guardar", description: String(e?.message || e) }); } finally { setSaving(false); }
    };

    const openCtx = (e: any, type: "street" | "camera" | "lote", id: string) => {
        const oe = e.originalEvent || e; oe.preventDefault?.(); oe.stopPropagation?.();
        setCtx({ x: oe.clientX, y: oe.clientY, type, id });
    };

    // ── Controles del mapa ──────────────────────────────────────────────
    const acercar = (d: number) => { const m = mapRef.current; if (m) m.setZoom(m.getZoom() + d); };
    const centrarBarrio = () => {
        const m = mapRef.current; if (!m) return;
        if (data.perimeter.length >= 3) m.fitBounds(L.latLngBounds(data.perimeter as any), { padding: [60, 60] });
        else m.setView(data.center as any, data.zoom);
    };
    const alternarPantalla = async () => {
        try {
            if (document.fullscreenElement) await document.exitFullscreen();
            else await contenedorRef.current?.requestFullscreen();
        } catch { }
    };
    // Un solo buscador: lo que se escribe abajo sirve para matrículas y para
    // saltar a una cámara o a una calle.
    const lugares = (() => {
        const q = (rec.plate || "").trim().toLowerCase();
        if (q.length < 2) return [] as Lugar[];
        const cams = data.cameras
            .map((c) => ({ tipo: "camara" as const, id: c.deviceId, nombre: devById[c.deviceId]?.name || "Cámara", lat: c.lat, lng: c.lng }))
            .filter((c) => c.nombre.toLowerCase().includes(q));
        const calles = data.streets
            .filter((st) => (st.name || "").toLowerCase().includes(q) && st.points.length)
            .map((st) => ({ tipo: "calle" as const, id: st.id, nombre: st.name || "Calle", lat: st.points[Math.floor(st.points.length / 2)][0], lng: st.points[Math.floor(st.points.length / 2)][1] }));
        return [...cams, ...calles].slice(0, 6);
    })();

    const irALugar = (l: Lugar) => {
        setVista3D(false);
        mapRef.current?.flyTo([l.lat, l.lng], l.tipo === "camara" ? 19 : 18, { duration: 0.9 });
        rec.setPlate("");
    };

    const capas: { k: keyof typeof verCapa; label: string; icon: any }[] = [
        { k: "camaras", label: "Cámaras", icon: Video },
        { k: "calles", label: "Calles", icon: RouteIco },
        { k: "lotes", label: "Casas", icon: Pentagon },
        { k: "perimetro", label: "Perímetro", icon: Hexagon },
        { k: "guardias", label: "Guardias", icon: ShieldCheck },
    ];

    const tools: { id: Tool; icon: any; label: string }[] = [
        { id: "select", icon: MousePointer2, label: "Seleccionar" },
        { id: "perimeter", icon: Hexagon, label: "Dibujar perímetro" },
        { id: "street", icon: Spline, label: "Dibujar calle" },
        { id: "camera", icon: Video, label: "Soltar cámara" },
        { id: "lote", icon: Pentagon, label: "Dibujar casa / lote" },
    ];

    return (
        <TooltipProvider delayDuration={150}>
            <style>{`
                .cam-live-popup .leaflet-popup-content-wrapper{background:transparent;box-shadow:none;padding:0;border:0}
                .cam-live-popup .leaflet-popup-content{margin:0}
                .cam-live-popup .leaflet-popup-tip{display:none}
                .cam-live-popup a.leaflet-popup-close-button{color:#fff;top:4px;right:6px}
                .cam-name-tip{background:rgba(17,17,17,.85);color:#fff;border:0;box-shadow:none;font-size:10px;font-weight:700;padding:1px 6px;border-radius:6px}
                .cam-name-tip:before{display:none}

                /* ── Mapa táctico ── */
                .omni-barrio .leaflet-tile-pane{filter:${FILTROS[base] || 'none'};transition:filter .25s ease}
                .omni-barrio .leaflet-pane.omni-rotulos{filter:none !important;opacity:.95}
                .omni-barrio .leaflet-control-attribution{background:rgba(8,9,11,.6)!important;color:#8b8b93!important;font-size:9px}
                .omni-barrio .leaflet-control-attribution a{color:#9aa4b2!important}
                .omni-barrio .leaflet-control-layers{background:rgba(14,16,20,.92)!important;color:#e5e7eb!important;
                    border:1px solid rgba(148,163,184,.22)!important;border-radius:12px!important;
                    box-shadow:0 12px 30px -12px rgba(0,0,0,.8)!important;backdrop-filter:blur(10px)}
                .omni-barrio .leaflet-control-layers-toggle{background-color:rgba(14,16,20,.92)!important;border-radius:12px!important}
                .omni-barrio .leaflet-control-layers label{font-size:12px;font-weight:600;padding:3px 2px}
                .omni-barrio .leaflet-control-layers-separator{border-color:rgba(148,163,184,.2)}
                .omni-vineta{position:absolute;inset:0;pointer-events:none;z-index:400;
                    box-shadow:inset 0 0 170px 45px rgba(0,0,0,.55)}
                .omni-vehiculo{filter:drop-shadow(0 0 10px rgba(251,191,36,.9))}
                /* El halo late aparte del auto: la rotacion cambia en cada cuadro y no
                   puede reiniciar la animacion del pulso. */
${CSS_AUTO}
                /* Un destello corto que corre por el camino ya hecho.
                   La linea de abajo queda solida: lo que se mueve es la luz, no el
                   camino. Un punteado en movimiento se lee como "ruta estimada", y esto
                   no es una estimacion: por ahi paso el vehiculo. */
                .omni-destello{stroke-dasharray:26 1400;stroke-linecap:round;
                    animation:omniDestello 2.6s linear infinite}
                @keyframes omniDestello{from{stroke-dashoffset:26}to{stroke-dashoffset:-1400}}
                .omni-punto-actual{filter:drop-shadow(0 0 7px rgba(251,191,36,.85));animation:omniLatido 1.8s ease-in-out infinite}
                @keyframes omniLatido{0%,100%{opacity:1}50%{opacity:.55}}
                .omni-sin-barra::-webkit-scrollbar{display:none}
                .omni-sin-barra{scrollbar-width:none}
                .omni-barrio .custom-scrollbar::-webkit-scrollbar{height:4px;width:4px}
                .omni-barrio .custom-scrollbar::-webkit-scrollbar-thumb{background:rgba(255,255,255,.18);border-radius:4px}
                .omni-reticula{position:absolute;inset:0;pointer-events:none;z-index:399;opacity:.14;
                    background-image:linear-gradient(rgba(148,163,184,.6) 1px,transparent 1px),
                                     linear-gradient(90deg,rgba(148,163,184,.6) 1px,transparent 1px);
                    background-size:130px 130px}
            `}</style>
            <div ref={contenedorRef} className="relative h-full w-full bg-[#07080a]">
                {vista3D ? (
                    <Mapa3D
                        center={data.center as [number, number]}
                        zoom={data.zoom}
                        pitch={data.pitch}
                        bearing={data.bearing}
                        onVista={(v) => { vista3DRef.current = v; }}
                        vivo={vivoTodas}
                        ocultas={ocultas}
                        nombre={(id: string) => devById[id]?.name || "Cámara"}
                        perimeter={data.perimeter as [number, number][]}
                        streets={data.streets as any}
                        cameras={data.cameras.map((c: any) => ({ ...c, nombre: devices.find((d: any) => d.id === c.deviceId)?.name })) as any}
                        puntos={rec.puntos}
                        traza={rec.traza}
                        avance={rec.avance}
                        indice={rec.indice}
                    />
                ) : (
                <MapContainer center={data.center} zoom={data.zoom} maxZoom={21} className="h-full w-full z-0 omni-barrio" style={{ background: "#07080a" }} zoomControl={false} scrollWheelZoom>
                    <Pane name="omni-rotulos" style={{ zIndex: 350 }} />
                    {/* Capas: se eligen con el selector flotante, no con el control de Leaflet */}
                    {(base === "Táctico" || base === "Calles") && (
                        <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxNativeZoom={19} maxZoom={21} />
                    )}
                    {(base === "Híbrido" || base === "Satélite") && (
                        <TileLayer attribution="&copy; Esri" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxNativeZoom={19} maxZoom={21} />
                    )}
                    {base === "Híbrido" && (
                        <>
                            {/* Nombres de calles sobre la foto satelital. Las capas de
                                referencia de Esri no traen calles de barrio a este zoom,
                                asi que los rotulos salen de CARTO (OpenStreetMap). */}
                            <TileLayer pane="omni-rotulos"
                                attribution="&copy; OpenStreetMap &copy; CARTO"
                                url="https://{s}.basemaps.cartocdn.com/rastertiles/dark_only_labels/{z}/{x}/{y}{r}.png"
                                subdomains="abcd" maxNativeZoom={18} maxZoom={21} />
                        </>
                    )}

                    <MapRefGrabber onMap={(m) => (mapRef.current = m)} />
                    {editing && tool !== "select" && <ClickHandler onClick={onMapClick} />}

                    {verCapa.perimetro && data.perimeter.length >= 3 && <Polygon positions={data.perimeter} pathOptions={{ color: "#22c55e", weight: 2, fillOpacity: 0.08 }} />}
                    {draftPerimeter.length > 0 && <Polyline positions={draftPerimeter} pathOptions={{ color: "#22c55e", weight: 2, dashArray: "6 6" }} />}

                    {/* Casas / lotes: polígono, nombre y vértices arrastrables al editar */}
                    {(verCapa.lotes ? lotes : []).map((lo) => {
                        const sel = selected?.type === "lote" && selected.id === lo.id;
                        const señalado = hoverLote?.id === lo.id;
                        const uni = unidadDe(lo.unitId);
                        return (
                            <React.Fragment key={lo.id}>
                                <Polygon positions={lo.points}
                                    pathOptions={{
                                        /* Señalado y seleccionado son dos cosas distintas y se
                                           ven distinto: señalar es pasar por encima, seleccionar
                                           es haber elegido. El hover sólo sube el relleno. */
                                        color: sel ? "#f59e0b" : lo.unitId ? "#38bdf8" : "#94a3b8",
                                        weight: sel ? 3 : señalado ? 3 : 2,
                                        fillColor: sel ? "#f59e0b" : lo.unitId ? "#38bdf8" : "#94a3b8",
                                        fillOpacity: sel ? 0.28 : señalado ? 0.26 : 0.14,
                                    }}
                                    eventHandlers={{
                                        click: () => setSelected({ type: "lote", id: lo.id }),
                                        contextmenu: (e) => openCtx(e, "lote", lo.id),
                                        mouseover: (e: any) => {
                                            const oe = e.originalEvent;
                                            setHoverLote({ id: lo.id, x: oe?.clientX ?? 0, y: oe?.clientY ?? 0 });
                                        },
                                        mousemove: (e: any) => {
                                            const oe = e.originalEvent;
                                            setHoverLote((h) => h?.id === lo.id
                                                ? { id: lo.id, x: oe?.clientX ?? h.x, y: oe?.clientY ?? h.y } : h);
                                        },
                                        mouseout: () => setHoverLote((h) => h?.id === lo.id ? null : h),
                                    }}>
                                    <LTooltip direction="center" permanent className="cam-name-tip">
                                        {lo.label}{uni ? ` · ${uni.name}` : ""}
                                    </LTooltip>
                                </Polygon>
                                {editing && sel && lo.points.map((pt, i) => (
                                    <Marker key={i} position={pt} draggable
                                        icon={L.divIcon({ className: "bg-transparent border-0", html: verticeHtml, iconSize: [12, 12], iconAnchor: [6, 6] })}
                                        eventHandlers={{
                                            drag: (e: any) => { const ll = e.target.getLatLng(); moverVertice(lo.id, i, [ll.lat, ll.lng]); },
                                            contextmenu: (e: any) => { e.originalEvent?.preventDefault?.(); quitarVertice(lo.id, i); },
                                        }} />
                                ))}
                            </React.Fragment>
                        );
                    })}
                    {draftLote.length > 0 && (
                        <Polygon positions={draftLote} pathOptions={{ color: "#38bdf8", weight: 2, dashArray: "6 6", fillOpacity: 0.12 }} />
                    )}

                    {(verCapa.calles ? data.streets : []).map((s) => (
                        <Polyline key={s.id} positions={s.points}
                            pathOptions={{ color: selected?.id === s.id ? "#f59e0b" : "#38bdf8", weight: selected?.id === s.id ? 6 : 4, opacity: 0.9 }}
                            eventHandlers={{
                                click: () => editing && tool === "select" && setSelected({ type: "street", id: s.id }),
                                contextmenu: (e) => openCtx(e, "street", s.id),
                            }}>
                            {s.name && <LTooltip sticky className="cam-name-tip">{s.name}</LTooltip>}
                        </Polyline>
                    ))}
                    {draftStreet.length > 0 && <Polyline positions={draftStreet} pathOptions={{ color: "#38bdf8", weight: 4, dashArray: "6 6" }} />}

                    {(verCapa.guardias ? guards : []).map((g) => (
                        <Marker key={"g" + g.id} position={[g.lat, g.lng]}
                            icon={L.divIcon({ className: "bg-transparent border-0", html: guardIconHtml(g.guardName || g.name || "Guardia", g.heading), iconSize: [60, 52], iconAnchor: [30, 44] })}>
                            <Popup>
                                <div style={{ minWidth: 140 }}>
                                    <b>{g.guardName || "Guardia"}</b><br />
                                    <span style={{ fontSize: 11, opacity: .7 }}>{g.deviceInfo || "Tablet"} · hace {Math.max(0, Math.round((Date.now() - (g.ts || Date.now())) / 1000))}s</span>
                                    {g.accuracy ? <><br /><span style={{ fontSize: 10, opacity: .5 }}>±{Math.round(g.accuracy)}m</span></> : null}
                                    {(g.battery != null || g.signal != null || g.heading != null || g.steps != null) && (
                                        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6, fontSize: 10, fontWeight: 700 }}>
                                            {g.battery != null && <span style={{ padding: "2px 6px", borderRadius: 6, background: g.battery <= 20 ? "#fee2e2" : "#dcfce7", color: g.battery <= 20 ? "#dc2626" : "#16a34a" }}>🔋 {g.battery}%{g.charging ? "⚡" : ""}</span>}
                                            {g.signal != null && g.signal >= 0 && <span style={{ padding: "2px 6px", borderRadius: 6, background: "#e0e7ff", color: "#4338ca" }}>📶 {g.signal}/4</span>}
                                            {g.heading != null && <span style={{ padding: "2px 6px", borderRadius: 6, background: "#f1f5f9", color: "#475569" }}>🧭 {Math.round(g.heading)}°</span>}
                                            {g.steps != null && g.steps > 0 && <span style={{ padding: "2px 6px", borderRadius: 6, background: "#f1f5f9", color: "#475569" }}>👣 {g.steps}</span>}
                                        </div>
                                    )}
                                </div>
                            </Popup>
                        </Marker>
                    ))}

                    {(verCapa.camaras ? data.cameras : []).map((c) => (
                        <Marker key={c.deviceId} position={[c.lat, c.lng]} icon={camIcon}
                            eventHandlers={{
                                click: () => { if (editing && tool === "select") setSelected({ type: "camera", id: c.deviceId }); },
                                contextmenu: (e) => openCtx(e, "camera", c.deviceId),
                            }}>
                            <LTooltip permanent direction="top" offset={[0, -22]} className="cam-name-tip">{devById[c.deviceId]?.name || "Cámara"}</LTooltip>
                            {!editing && (
                                <Popup className="cam-live-popup" maxWidth={280} minWidth={260}>
                                    <div className="rounded-lg overflow-hidden">
                                        <LiveMp4 deviceId={c.deviceId} />
                                        <div className="px-2 py-1 bg-black/80 text-white text-[11px] font-bold flex items-center gap-1.5"><Radio size={11} className="text-red-400" /> {devById[c.deviceId]?.name || "Cámara"}</div>
                                    </div>
                                </Popup>
                            )}
                        </Marker>
                    ))}
                    <FlowAnims anims={flow.anims} pulses={flow.pulses} onDone={flow.onDone} />
                    {vivoTodas && !editing && (
                        <BurbujasVivo
                            camaras={data.cameras.filter((c: any) => !ocultas.includes(c.deviceId))}
                            nombre={(id) => devById[id]?.name || "Cámara"}
                            onCerrarUna={(id) => setOcultas((o) => [...o, id])}
                        />
                    )}
                    <CapaRecorrido puntos={rec.puntos} estacionados={rec.estacionados} traza={rec.traza} avance={rec.avance} indice={rec.indice}
                        onElegir={(i) => { rec.setReproduciendo(false); rec.setAvance(i); }} />
                </MapContainer>
                )}
                {!vista3D && oscura && <><div className="omni-reticula" /><div className="omni-vineta" /></>}
                <PanelRecorrido {...rec} lugares={lugares} onIrA={irALugar} onVerCuadro={setCuadroRecorrido}
                    ultimas={ultimasPasadas} onUltima={(u) => flow.animateEvent({ id: u.id } as any)} />

                {cuadroRecorrido && (
                    <VisorCuadro
                        fila={{
                            plate: cuadroRecorrido.plate,
                            cameraName: cuadroRecorrido.cameraName,
                            timestamp: cuadroRecorrido.timestamp,
                            confidence: cuadroRecorrido.confidence,
                            snapshotUrl: cuadroRecorrido.snapshotUrl,
                        }}
                        onCerrar={() => setCuadroRecorrido(null)}
                    />
                )}

                {/* Columnas de flujo en vivo */}
                {!editing && (
                    <>
                        <FlowColumn side="left" title="Entradas" icon={LogIn} accent="emerald" events={flow.entries} cargando={flow.cargando} onPick={(ev) => flow.animateEvent(ev)} />
                        <FlowColumn side="right" title="Salidas" icon={LogOut} accent="orange" events={flow.exits} cargando={flow.cargando} onPick={(ev) => flow.animateEvent(ev)} />
                    </>
                )}

                {/* ── LA BARRA ──────────────────────────────────────────────────────
                    Es el bloque "Icon bar" de Bencho (bencho.dev, MIT). Lo que aporta no
                    es el vidrio sino el INDICADOR DE DOS FASES: al cambiar de herramienta
                    la píldora primero se estira hasta cubrir la que deja y la que toma, y
                    recién después se contrae sobre el destino pasándose un poco. Se lee
                    como un objeto que se mueve, no como un fondo que se teletransporta.

                    Por eso las herramientas de dibujo van como `items` — son una sola
                    selección, que es lo que el indicador sabe representar — y acercar,
                    alejar, centrar, vivo y pantalla completa van como `acciones`: no
                    tienen estado donde quedarse, así que no se llevan el indicador. El
                    menú de capas y el botón principal van adentro de la misma barra y no
                    al lado, porque tres píldoras separadas no se leen como una barra de
                    herramientas sino como tres cosas alineadas por casualidad. */}
                <motion.div layout transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    className="absolute top-4 left-1/2 -translate-x-1/2 z-[530] max-w-[calc(100%-1.5rem)] flex flex-col items-start">
                    <IconBar
                        superficie="oscura"
                        className="shadow-2xl shadow-black/50 max-w-full"
                        corner={26}
                        glyph={15}
                        items={editing ? tools.map((t) => ({ key: t.id, label: t.label, Icon: t.icon })) : []}
                        value={editing ? tool : undefined}
                        onChange={(k) => { setTool(k as Tool); setSelected(null); }}
                        acciones={[
                            { key: "mas", label: "Acercar", Icon: Plus, onClick: () => acercar(1), off: vista3D },
                            { key: "menos", label: "Alejar", Icon: Minus, onClick: () => acercar(-1), off: vista3D },
                            { key: "centrar", label: "Centrar en el barrio", Icon: Crosshair, onClick: centrarBarrio, off: vista3D },
                            {
                                key: "vivo",
                                label: vivoTodas ? "Apagar las cámaras en vivo" : "Ver todas las cámaras en vivo",
                                Icon: vivoTodas ? EyeOff : Eye,
                                onClick: () => { setOcultas([]); setVivoTodas((v) => !v); },
                                activa: vivoTodas,
                                tono: "alerta" as const,
                            },
                            {
                                key: "pantalla",
                                label: pantallaCompleta ? "Salir de pantalla completa" : "Pantalla completa",
                                Icon: pantallaCompleta ? Minimize2 : Maximize2,
                                onClick: alternarPantalla,
                            },
                            ...(editing ? [{
                                key: "borrar", label: "Borrar seleccionado", Icon: Trash2,
                                onClick: deleteSelected, off: !selected,
                            }] : []),
                        ]}
                        antes={
                            /* Sólo el botón. El desplegable vive AFUERA de la barra: un
                               menú absoluto no puede salir de un contenedor que recorta, y
                               la barra recorta para poder desplazarse en pantallas
                               angostas. Dos requisitos que no conviven adentro del mismo
                               elemento, así que se separan. */
                            <button type="button" data-abierto={menuCapas || undefined}
                                onClick={(e) => { e.stopPropagation(); setMenuCapas((v) => !v); }}
                                className="gnav-ancho">
                                <Layers3 size={14} />
                                {vista3D ? "Vista 3D" : base}
                                <ChevronDown size={12} className={cn("transition-transform", menuCapas && "rotate-180")} />
                            </button>
                        }
                        despues={
                            /* La acción principal, siempre en la misma punta de la barra. */
                            !editing ? (
                                <button type="button" data-principal="editar" className="gnav-ancho"
                                    title="Dibujar perímetro, calles y cámaras"
                                    onClick={() => { setVista3D(false); setEditing(true); setMenuCapas(false); }}>
                                    <Pencil size={14} /> Editar mapa
                                </button>
                            ) : (
                                <>
                                    <button type="button" data-principal="guardar" className="gnav-ancho"
                                        onClick={save} disabled={saving}
                                        title="Guarda el dibujo, la vista y la capa elegida">
                                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                        Guardar
                                        {sinGuardar && !saving && (
                                            /* El punto no es adorno: es la única señal de que lo
                                               que se ve en el mapa todavía no está en la base. */
                                            <span className="ml-1 w-1.5 h-1.5 rounded-full bg-[var(--aviso)] animate-pulse" />
                                        )}
                                    </button>
                                    <button type="button" className="gnav-item" title="Salir sin guardar"
                                        onClick={() => {
                                            if (sinGuardar && !window.confirm("Hay dibujo sin guardar. ¿Salir y perder los cambios?")) return;
                                            setEditing(false); setTool("select"); setDraftPerimeter([]); setDraftStreet([]); setDraftLote([]);
                                            setSelected(null); setAsignando(null); setSinGuardar(false); getBarrioMap().then(setData);
                                        }}>
                                        <X size={15} />
                                    </button>
                                </>
                            )
                        }
                    />

                    {/* El menú de capas, colgado de la barra y por fuera de ella. */}
                    <AnimatePresence>
                        {menuCapas && (
                            <motion.div initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.97 }}
                                transition={{ type: "spring", stiffness: 460, damping: 34 }} onClick={(e) => e.stopPropagation()}
                                className="mt-2 w-[188px] p-1.5 rounded-2xl bg-card/95 backdrop-blur-2xl border border-border shadow-2xl shadow-black/40 origin-top">
                                <p className="px-2 pt-1 pb-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground/70">Mapa de fondo</p>
                                <div className="grid grid-cols-2 gap-0.5">
                                    {["Híbrido", "Táctico", "Satélite", "Calles"].map((nb) => (
                                        <button key={nb} onClick={() => { setBase(nb); setVista3D(false); }}
                                            className="relative h-7 rounded-lg text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors">
                                            {base === nb && !vista3D && (
                                                <motion.span layoutId="capa-activa" transition={{ type: "spring", stiffness: 420, damping: 34 }}
                                                    className="absolute inset-0 rounded-lg bg-foreground/[0.12]" />
                                            )}
                                            <span className={cn("relative", base === nb && !vista3D && "text-foreground")}>{nb}</span>
                                        </button>
                                    ))}
                                </div>
                                <button onClick={() => setVista3D((v) => !v)}
                                    className="relative w-full h-7 mt-0.5 rounded-lg text-[11px] font-bold text-muted-foreground hover:text-foreground transition-colors">
                                    {vista3D && ayuda3D && (
                                        <motion.span layoutId="capa-activa" transition={{ type: "spring", stiffness: 420, damping: 34 }}
                                            className="absolute inset-0 rounded-lg bg-sky-400/25" />
                                    )}
                                    <span className={cn("relative", vista3D && "text-sky-600 dark:text-sky-200")}>Vista 3D · girar e inclinar</span>
                                </button>
                                {!vista3D && (<>
                                    <span className="block h-px bg-border mx-1 my-1.5" />
                                    <p className="px-2 pb-1 text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground/70">Mostrar</p>
                                    {capas.map(({ k, label, icon: Ic }) => {
                                        const on = verCapa[k];
                                        return (
                                            <button key={k} onClick={() => setVerCapa((v) => ({ ...v, [k]: !v[k] }))}
                                                className={cn("w-full flex items-center gap-2 h-7 px-2 rounded-lg text-[11px] font-semibold transition-colors",
                                                    on ? "text-foreground hover:bg-accent" : "text-muted-foreground/60 hover:text-foreground")}>
                                                <Ic size={12} />
                                                <span className="flex-1 text-left">{label}</span>
                                                {on ? <Eye size={11} className="opacity-60" /> : <EyeOff size={11} className="opacity-60" />}
                                            </button>
                                        );
                                    })}
                                </>)}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.div>

                {/* Contextual editing panel */}
                {editing && (
                    <div className="absolute bottom-4 left-4 z-[500] bg-card/95 backdrop-blur border border-border rounded-xl shadow-lg p-3 w-64 text-xs space-y-2">
                        {tool === "perimeter" && (<>
                            <p className="font-bold flex items-center gap-1.5"><Hexagon size={13} className="text-emerald-400" /> Perímetro</p>
                            <p className="text-muted-foreground">Clic en el mapa para agregar vértices ({draftPerimeter.length}).</p>
                            <div className="flex gap-2"><button onClick={commitPerimeter} disabled={draftPerimeter.length < 3} className="flex-1 py-1.5 rounded-md bg-emerald-600 text-white font-bold disabled:opacity-40 flex items-center justify-center gap-1"><Check size={13} /> Cerrar</button><button onClick={() => setDraftPerimeter((p) => p.slice(0, -1))} className="px-2 py-1.5 rounded-md bg-accent"><Undo2 size={13} /></button></div>
                        </>)}
                        {tool === "street" && (<>
                            <p className="font-bold flex items-center gap-1.5"><Spline size={13} className="text-sky-400" /> Calle</p>
                            <p className="text-muted-foreground">Clic para trazar ({draftStreet.length} puntos).</p>
                            <div className="flex gap-2"><button onClick={commitStreet} disabled={draftStreet.length < 2} className="flex-1 py-1.5 rounded-md bg-sky-600 text-white font-bold disabled:opacity-40 flex items-center justify-center gap-1"><Check size={13} /> Finalizar</button><button onClick={() => setDraftStreet((p) => p.slice(0, -1))} className="px-2 py-1.5 rounded-md bg-accent"><Undo2 size={13} /></button></div>
                        </>)}
                        {tool === "camera" && (<>
                            <p className="font-bold flex items-center gap-1.5"><Video size={13} className="text-blue-400" /> Soltar cámara</p>
                            <select value={pendingCam} onChange={(e) => setPendingCam(e.target.value)} className="w-full bg-background border border-border rounded-md px-2 py-1.5">
                                <option value="">Elegí una cámara…</option>
                                {unplaced.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                            <p className="text-muted-foreground">{pendingCam ? "Clic en el mapa para ubicarla." : `Ubicadas: ${placedIds.size}`}</p>
                        </>)}
                        {tool === "lote" && (<>
                            <p className="font-bold flex items-center gap-1.5"><Pentagon size={13} className="text-sky-400" /> Casa / lote</p>
                            <p className="text-muted-foreground">Clic en el mapa para marcar las esquinas ({draftLote.length}). Con 3 o más, cerrá el contorno.</p>
                            <div className="flex gap-2"><button onClick={commitLote} disabled={draftLote.length < 3} className="flex-1 py-1.5 rounded-md bg-sky-600 text-white font-bold disabled:opacity-40 flex items-center justify-center gap-1"><Check size={13} /> Cerrar</button><button onClick={() => setDraftLote((p) => p.slice(0, -1))} className="px-2 py-1.5 rounded-md bg-accent"><Undo2 size={13} /></button></div>
                        </>)}
                        {tool === "select" && selected?.type === "lote" && (() => {
                            const lo = lotes.find((l) => l.id === selected.id);
                            const uni = unidadDe(lo?.unitId);
                            return (<>
                                <p className="font-bold flex items-center gap-1.5"><Pentagon size={13} className="text-amber-400" /> {lo?.label}</p>
                                <p className="text-muted-foreground">{uni ? `Unidad: ${uni.name}` : "Sin unidad asignada."}</p>
                                <p className="text-muted-foreground">
                                    {plazaDe(lo?.parkingSlotId)
                                        ? `Plaza: ${plazaDe(lo?.parkingSlotId)?.label}`
                                        : "Sin plaza de estacionamiento."}
                                </p>
                                <p className="text-muted-foreground">Arrastrá los puntos blancos para ajustar el contorno; clic derecho sobre uno lo quita.</p>
                                <div className="flex gap-2">
                                    <button onClick={() => setAsignando({ id: lo!.id, que: "unidad" })} className="flex-1 py-1.5 rounded-md accion font-bold flex items-center justify-center gap-1"><Home size={13} /> {uni ? "Cambiar unidad" : "Asignar unidad"}</button>
                                    <button onClick={() => renameLote(lo!.id)} className="px-2 py-1.5 rounded-md bg-accent"><PencilIcon size={13} /></button>
                                </div>
                                <button onClick={() => setAsignando({ id: lo!.id, que: "plaza" })}
                                    className="w-full py-1.5 rounded-md bg-accent font-bold flex items-center justify-center gap-1">
                                    <SquareParking size={13} /> {plazaDe(lo?.parkingSlotId) ? "Cambiar plaza" : "Asignar plaza"}
                                </button>
                            </>);
                        })()}
                        {tool === "select" && selected?.type !== "lote" && (<p className="text-muted-foreground flex items-center gap-1.5"><MapPin size={13} /> {selected ? `Seleccionado: ${selected.type === "camera" ? (devById[selected.id]?.name || "cámara") : "calle"}` : "Tocá una casa, calle o cámara (o clic derecho para menú)."}</p>)}
                    </div>
                )}

                {/*
                  * La ficha del lote, al lado del puntero.
                  *
                  * Aparece al señalar y se va sola. No lleva ningún botón a propósito: si
                  * tuviera, habría que poder llegar hasta ella con el mouse, y entonces
                  * dejaría de poder desaparecer al salir del polígono — que es lo que la
                  * hace liviana. Para actuar están el clic y el menú del botón derecho.
                  *
                  * Muestra lo que hay y dice qué falta, en vez de esconder los campos
                  * vacíos: un lote sin unidad asignada no es un lote sin datos, es un lote
                  * al que le falta el dato más importante.
                  */}
                <AnimatePresence>
                    {hoverLote && (() => {
                        const lo = lotes.find((l) => l.id === hoverLote.id);
                        if (!lo) return null;
                        const uni = unidadDe(lo.unitId);
                        const pl = plazaDe(lo.parkingSlotId);
                        const gente: any[] = uni?.users || [];
                        const chapas = gente.flatMap((r: any) => (r.vehicles || []).map((v: any) => v.plate)).filter(Boolean);
                        /* Que no se salga de la pantalla: pegada al borde queda cortada
                           justo cuando el lote está en la orilla del mapa. */
                        const ANCHO = 260, ALTO = 190;
                        const x = Math.min(hoverLote.x + 16, (typeof window !== "undefined" ? window.innerWidth : 1200) - ANCHO - 12);
                        const y = Math.min(hoverLote.y + 16, (typeof window !== "undefined" ? window.innerHeight : 800) - ALTO - 12);
                        return (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.94, y: 6 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.96, y: 4 }}
                                transition={{ type: "spring", stiffness: 520, damping: 34, mass: 0.6 }}
                                style={{ left: x, top: y, width: ANCHO }}
                                className="fixed z-[580] pointer-events-none rounded-2xl bg-[#0a0d12]/94 backdrop-blur-2xl border border-white/[0.1] shadow-2xl shadow-black/70 overflow-hidden">

                                <div className="flex items-center gap-2 px-3 h-10 border-b border-white/[0.07]">
                                    <Pentagon size={13} className="text-amber-400 shrink-0" />
                                    <span className="text-[12.5px] font-bold text-white truncate">{lo.label}</span>
                                </div>

                                <div className="px-3 py-2.5 space-y-2">
                                    <div>
                                        <p className="text-[9px] uppercase tracking-[0.14em] text-white/35">Unidad</p>
                                        <p className={cn("text-[12px] truncate", uni ? "text-white/90 font-semibold" : "text-white/35 italic")}>
                                            {uni ? uni.name : "sin asignar"}
                                        </p>
                                    </div>

                                    <div>
                                        <p className="text-[9px] uppercase tracking-[0.14em] text-white/35">Residentes</p>
                                        {gente.length ? (
                                            <p className="text-[12px] text-white/85 truncate">
                                                {gente.slice(0, 2).map((r: any) => r.name).join(", ")}
                                                {gente.length > 2 && <span className="text-white/40"> y {gente.length - 2} más</span>}
                                            </p>
                                        ) : (
                                            <p className="text-[12px] text-white/35 italic">nadie cargado</p>
                                        )}
                                    </div>

                                    {chapas.length > 0 && (
                                        <div className="flex flex-wrap gap-1">
                                            {chapas.slice(0, 4).map((c: string, i: number) => (
                                                <span key={i} className="px-1.5 py-0.5 rounded bg-white/10 border border-white/15 text-[10.5px] font-bold tabular-nums tracking-[0.1em] text-white/90">
                                                    {c}
                                                </span>
                                            ))}
                                            {chapas.length > 4 && <span className="text-[10px] text-white/40 self-center">+{chapas.length - 4}</span>}
                                        </div>
                                    )}

                                    <div className="flex items-center gap-1.5 pt-0.5 border-t border-white/[0.07]">
                                        <SquareParking size={12} className="text-white/40 shrink-0" />
                                        {pl ? (
                                            <>
                                                <span className="text-[11.5px] text-white/85">{pl.label}</span>
                                                <span className="text-[10px]" style={{ color: pl.isOccupied ? "var(--quieto)" : "var(--muted-foreground)" }}>
                                                    · {pl.isOccupied ? "ocupada" : "libre"}
                                                </span>
                                            </>
                                        ) : (
                                            <span className="text-[11.5px] text-white/35 italic">sin plaza</span>
                                        )}
                                    </div>
                                </div>
                            </motion.div>
                        );
                    })()}
                </AnimatePresence>

                {/* Lo que todavía no está en la base. Va arriba y al centro, sobre el mapa:
                    el punto del botón se puede no mirar, una franja no. */}
                {editing && sinGuardar && (
                    <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[560] pointer-events-none">
                        <span className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-[#0a0d12]/92 backdrop-blur-xl border text-[12px] font-semibold text-white shadow-lg"
                            style={{ borderColor: "color-mix(in oklab, var(--aviso) 45%, transparent)" }}>
                            <AlertTriangle size={13} style={{ color: "var(--aviso)" }} />
                            Cambios sin guardar
                        </span>
                    </div>
                )}

                {/* Asignar una unidad o una plaza al lote */}
                <AnimatePresence>
                    {asignando && (() => {
                        const lo = lotes.find((l) => l.id === asignando.id);
                        const q = buscaUnidad.trim().toLowerCase();
                        const usadas: Record<string, string> = {};
                        for (const l of lotes) if (l.unitId && l.id !== asignando.id) usadas[l.unitId] = l.label;
                        const lista = unidades
                            .filter((u: any) => !q || `${u.name} ${u.number || ""} ${u.lot || ""} ${u.houseNumber || ""}`.toLowerCase().includes(q))
                            .slice(0, 60);
                        const plazaUsada: Record<string, string> = {};
                        for (const l of lotes) if (l.parkingSlotId && l.id !== asignando.id) plazaUsada[l.parkingSlotId] = l.label;
                        const listaPlazas = plazas
                            .filter((pl: any) => !q || String(pl.label || "").toLowerCase().includes(q))
                            .slice(0, 60);
                        return (
                            <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}
                                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                                className="absolute bottom-4 left-4 z-[560] w-72 rounded-2xl bg-[#0a0d12]/92 backdrop-blur-2xl border border-white/[0.08] shadow-2xl shadow-black/60 overflow-hidden">
                                <div className="flex items-center gap-2 px-3 h-11 border-b border-white/[0.07]">
                                    {asignando.que === "plaza"
                                        ? <SquareParking size={14} className="text-white/60 shrink-0" />
                                        : <Home size={14} className="text-white/60 shrink-0" />}
                                    <span className="text-[12px] font-bold text-white truncate flex-1">
                                        {lo?.label} · {asignando.que === "plaza" ? "plaza" : "unidad"}
                                    </span>
                                    <button onClick={() => { setAsignando(null); setBuscaUnidad(""); }} className="text-white/40 hover:text-white"><X size={13} /></button>
                                </div>
                                <div className="flex items-center gap-2 px-3 h-10 border-b border-white/[0.07]">
                                    <Search size={13} className="text-white/35 shrink-0" />
                                    <input autoFocus value={buscaUnidad} onChange={(e) => setBuscaUnidad(e.target.value)}
                                        placeholder={asignando.que === "plaza" ? "Buscar plaza…" : "Buscar unidad…"}
                                        className="flex-1 bg-transparent text-[12px] text-white placeholder:text-white/30 focus:outline-none" />
                                </div>
                                <div className="max-h-64 overflow-y-auto custom-scrollbar">
                                    {asignando.que === "plaza" ? (<>
                                        {lo?.parkingSlotId && (
                                            <button onClick={() => asignarPlaza(lo.id, null)}
                                                className="w-full text-left px-3 py-2 text-[11.5px] text-[var(--mal-texto)] hover:bg-white/[0.08]">
                                                Quitar la plaza asignada
                                            </button>
                                        )}
                                        {listaPlazas.length === 0 ? (
                                            <p className="px-3 py-4 text-[11px] text-white/40">
                                                {plazas.length ? "No hay plazas con ese nombre." : "Todavía no hay plazas dibujadas en el plano de estacionamiento."}
                                            </p>
                                        ) : listaPlazas.map((pl: any) => {
                                            /* Una plaza tomada por OTRO lote se muestra igual, con su aviso: a
                                               veces hay que corregir justamente eso, y esconderla obligaría a
                                               ir a buscar cuál era. */
                                            const enOtro = plazaUsada[pl.id];
                                            return (
                                                <button key={pl.id} onClick={() => asignarPlaza(asignando.id, pl.id)}
                                                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.08] transition-colors">
                                                    <span className="flex-1 min-w-0">
                                                        <span className="block text-[12px] text-white/90 truncate">{pl.label}</span>
                                                        <span className="block text-[10px] text-white/35 truncate">
                                                            {pl.isOccupied ? "ocupada ahora" : "libre"}
                                                        </span>
                                                    </span>
                                                    {enOtro && <span className="text-[9px] text-amber-300/80 shrink-0">ya en {enOtro}</span>}
                                                    {lo?.parkingSlotId === pl.id && <Check size={13} className="text-emerald-400 shrink-0" />}
                                                </button>
                                            );
                                        })}
                                    </>) : (<>
                                        {lo?.unitId && (
                                            <button onClick={() => asignarUnidad(lo.id, null)}
                                                className="w-full text-left px-3 py-2 text-[11.5px] text-[var(--mal-texto)] hover:bg-white/[0.08]">
                                                Quitar la unidad asignada
                                            </button>
                                        )}
                                        {lista.length === 0 ? (
                                            <p className="px-3 py-4 text-[11px] text-white/40">No hay unidades con ese nombre.</p>
                                        ) : lista.map((u: any) => {
                                            const ocupada = usadas[u.id];
                                            return (
                                                <button key={u.id} onClick={() => asignarUnidad(asignando.id, u.id)}
                                                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.08] transition-colors">
                                                    <span className="flex-1 min-w-0">
                                                        <span className="block text-[12px] text-white/90 truncate">{u.name}</span>
                                                        {(u.lot || u.houseNumber || u.address) && (
                                                            <span className="block text-[10px] text-white/35 truncate">{[u.lot, u.houseNumber, u.address].filter(Boolean).join(" · ")}</span>
                                                        )}
                                                    </span>
                                                    {ocupada && <span className="text-[9px] text-amber-300/80 shrink-0">ya en {ocupada}</span>}
                                                    {lo?.unitId === u.id && <Check size={13} className="text-emerald-400 shrink-0" />}
                                                </button>
                                            );
                                        })}
                                    </>)}
                                </div>
                            </motion.div>
                        );
                    })()}
                </AnimatePresence>

                {/* Context menu */}
                {ctx && (
                    <div className="fixed z-[600] bg-popover border border-border rounded-lg shadow-xl py-1 text-xs min-w-[160px]" style={{ left: ctx.x, top: ctx.y }} onClick={(e) => e.stopPropagation()}>
                        {ctx.type === "lote" ? (() => {
                            /*
                             * El menú cambia según se esté editando o mirando.
                             *
                             * Antes ofrecía siempre lo mismo — asignar, renombrar, borrar —
                             * incluso fuera del modo edición, donde esos cambios quedaban en
                             * el aire: no hay botón de Guardar fuera de edición, así que
                             * tocarlos dejaba el mapa sucio sin manera de guardarlo.
                             *
                             * Mirando, lo que se quiere es ir a los datos de esa casa. Por eso
                             * las opciones son de lectura, y la última ofrece entrar a editar.
                             */
                            const lo = lotes.find((l) => l.id === ctx.id);
                            const uni = unidadDe(lo?.unitId);
                            if (!editing) return (<>
                                <div className="px-3 py-1.5 text-[11px] font-bold text-foreground truncate border-b border-border mb-1">
                                    {lo?.label}
                                </div>
                                <button onClick={() => { setSelected({ type: "lote", id: ctx.id }); setCtx(null); }}
                                    className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2">
                                    <Pentagon size={13} /> Seleccionar
                                </button>
                                {uni && (
                                    <button onClick={() => { router.push(`/admin/units?buscar=${encodeURIComponent(uni.name)}`); }}
                                        className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2">
                                        <Home size={13} /> Ver la unidad {uni.name}
                                    </button>
                                )}
                                {chapasDelLote(lo).length > 0 && (
                                    <button onClick={() => { router.push(`/admin/history?search=${encodeURIComponent(chapasDelLote(lo)[0])}`); }}
                                        className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2">
                                        <RouteIco size={13} /> Pasadas de {chapasDelLote(lo)[0]}
                                    </button>
                                )}
                                {lo?.parkingSlotId && (
                                    <button onClick={() => { router.push("/admin/plazas"); }}
                                        className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2">
                                        <SquareParking size={13} /> Ver la plaza
                                    </button>
                                )}
                                <button onClick={() => { setEditing(true); setSelected({ type: "lote", id: ctx.id }); setCtx(null); }}
                                    className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2 border-t border-border mt-1">
                                    <Pencil size={13} /> Editar el mapa
                                </button>
                            </>);
                            return (<>
                                <button onClick={() => { setSelected({ type: "lote", id: ctx.id }); setAsignando({ id: ctx.id, que: "unidad" }); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><Home size={13} /> Asignar unidad</button>
                                <button onClick={() => { setSelected({ type: "lote", id: ctx.id }); setAsignando({ id: ctx.id, que: "plaza" }); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><SquareParking size={13} /> Asignar plaza</button>
                                <button onClick={() => { renameLote(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><PencilIcon size={13} /> Renombrar</button>
                                <button onClick={() => { removeLote(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2 text-[var(--mal-texto)]"><Trash2 size={13} /> Borrar casa</button>
                            </>);
                        })() : ctx.type === "camera" ? (<>
                            <button onClick={() => { const dev = devById[ctx.id]; if (dev && mapRef.current) { const cam = data.cameras.find((c) => c.deviceId === ctx.id); if (cam) mapRef.current.setView([cam.lat, cam.lng], Math.max(mapRef.current.getZoom(), 18)); } setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><Radio size={13} className="text-red-400" /> Centrar / ver</button>
                            <button onClick={() => { removeCamera(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2 text-red-400"><Trash2 size={13} /> Quitar del mapa</button>
                        </>) : (<>
                            <button onClick={() => { renameStreet(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><PencilIcon size={13} /> Renombrar calle</button>
                            <button onClick={() => { removeStreet(ctx.id); setCtx(null); }} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2 text-red-400"><Trash2 size={13} /> Borrar calle</button>
                        </>)}
                    </div>
                )}

                {/* El chip "Mapa del barrio" estaba acá. Se retiró: decía el nombre de la
                    pantalla en la que uno ya está, y el recuento de cámaras, calles y casas
                    es de la clase de dato que se mira una vez en la vida y después estorba
                    todos los días, justo en la esquina donde arranca la lectura. Lo que sí
                    importa de ahí — cuántos guardias hay — se ve en el mapa mismo. */}

                {vista3D && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                        className="absolute bottom-[104px] left-3 z-[520] rounded-2xl px-3 py-2 text-[10px] leading-relaxed text-white/60 bg-[#0a0d12]/80 backdrop-blur-2xl border border-white/[0.08] shadow-2xl shadow-black/50">
                        <b className="text-white/80">Vista 3D</b><br />
                        Arrastrar: mover · Ctrl + arrastrar: girar e inclinar<br />
                        Rueda: acercar · La edición se hace en la vista plana
                    </motion.div>
                )}
            </div>
        </TooltipProvider>
    );
}


