"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Circle, CircleMarker, Marker, Polyline, Popup, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { CircleDashed, Crosshair, EyeOff, Loader2, MapPin, Plus, Radio, Route, Server, ToggleLeft, ToggleRight, X } from "lucide-react";
import { sileo as toast } from "sileo";
import {
    borrarGeocercaGps, cambiarIconoGps, comandoGps, geocercasGps, guardarGeocercaGps, rastreadoresGps, recorridoGps,
    type ComandoGps, type Geocerca, type Rastreador, type RecorridoGps,
} from "@/app/actions/gps";
import { Button } from "@/components/ui/button";
import { DeleteButton } from "@/components/ui/delete-button";
import { fechaHora, hace, hora } from "@/lib/fechas";
import { cn } from "@/lib/utils";

/**
 * Los rastreadores GPS sobre el mapa: dónde está cada uno, su menú, sus controles y su recorrido.
 *
 * Pedidos de Nico (20/11): «debes agregarlo en el mapa con su posición y datos» y, al verlo,
 * «permite cambiar el ícono, debe tener menú contextual, debemos poder accionar sus controles
 * desde ahí también, debo poder ver sus recorridos».
 *
 * Lo que el dibujo dice sin que haya que abrir nada:
 *  · **Verde** — en línea y con posición de recién: el vehículo está ahí.
 *  · **Ámbar** — en línea pero la posición es vieja: quedó bajo techo y sin satélites. El punto
 *    es dónde ENTRÓ. Pintarlo igual que el verde sería afirmar algo que el equipo no sabe.
 *  · **Gris** — no reporta. Es lo último que se supo.
 *  · **Aro rojo** — tiene el relé accionado.
 *
 * El menú (clic derecho, o mantener apretado en una pantalla táctil) usa las mismas acciones que
 * Dispositivos › GPS: la regla que impide accionar el relé con el vehículo andando vive en el
 * servidor, así que no hay un camino por el mapa que la esquive.
 */

const REFRESCO_MS = 15_000;
/** Con una posición más vieja que esto, estando en línea, se entiende que perdió los satélites. */
const POSICION_VIEJA_MS = 10 * 60_000;
const VERDE = "#10b981", AMBAR = "#f59e0b", GRIS = "#64748b", ROJO = "#ef4444", CELESTE = "#38bdf8";

const tonoDe = (r: Rastreador) => {
    if (!r.enLinea) return GRIS;
    const vieja = !r.cuando || Date.now() - new Date(r.cuando).getTime() > POSICION_VIEJA_MS;
    return vieja ? AMBAR : VERDE;
};

/**
 * Los dibujos entre los que se elige. Trazos de 24×24 (los de Lucide, licencia ISC), escritos
 * acá como texto porque el marcador de Leaflet es HTML crudo y no un componente de React.
 */
const ICONOS: Record<string, { rotulo: string; svg: string }> = {
    auto: { rotulo: "Auto", svg: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>' },
    camion: { rotulo: "Camión", svg: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>' },
    moto: { rotulo: "Moto", svg: '<circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>' },
    persona: { rotulo: "Persona", svg: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>' },
    punto: { rotulo: "Punto", svg: '<circle cx="12" cy="12" r="4" fill="#fff"/>' },
};
const trazo = (svg: string, lado = 18) => `<svg width="${lado}" height="${lado}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svg}</svg>`;

function icono(r: Rastreador): L.DivIcon {
    const c = tonoDe(r);
    const andando = (r.velocidad || 0) > 3 && c === VERDE;
    const rotulo = (r.matricula || r.nombre || r.imei.slice(-6)).replace(/[<>&]/g, "");
    const dibujo = ICONOS[r.icono || "auto"] || ICONOS.auto;
    /* La flecha de rumbo va AFUERA del círculo y sólo si se está moviendo: un vehículo quieto no
       tiene rumbo, y el que informa el equipo parado es el último que tuvo. */
    const flecha = andando
        ? `<div style="position:absolute;inset:-9px;transform:rotate(${r.rumbo || 0}deg);pointer-events:none"><div style="margin:0 auto;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:10px solid ${c}"></div></div>`
        : "";
    return L.divIcon({
        className: "bg-transparent border-0",
        html: `<div style="display:flex;flex-direction:column;align-items:center;gap:3px">
            <div style="position:relative;width:36px;height:36px">
                ${flecha}
                <div style="width:36px;height:36px;border-radius:50%;background:${c};border:3px solid ${r.cortado ? ROJO : "#fff"};box-shadow:0 2px 8px rgba(0,0,0,.45);display:grid;place-items:center">${trazo(dibujo.svg)}</div>
            </div>
            <div style="padding:1px 7px;border-radius:999px;background:rgba(10,14,20,.85);color:#fff;font:700 11px/16px Outfit,system-ui,sans-serif;white-space:nowrap">${rotulo}</div>
        </div>`,
        iconSize: [96, 62], iconAnchor: [48, 18], popupAnchor: [0, -20],
    });
}

/** Los tramos de tiempo que se ofrecen para el recorrido. */
const TRAMOS: { horas: number; rotulo: string }[] = [
    { horas: 6, rotulo: "6 h" }, { horas: 24, rotulo: "24 h" }, { horas: 72, rotulo: "3 días" }, { horas: 168, rotulo: "7 días" },
];

export function CapaGps() {
    const mapa = useMap();
    const [lista, setLista] = useState<Rastreador[]>([]);
    /** El recorrido a la vista: de quién, de cuántas horas, y lo que trajo el servidor. */
    const [ruta, setRuta] = useState<{ imei: string; horas: number; datos: RecorridoGps | null } | null>(null);
    const [menu, setMenu] = useState<{ imei: string; x: number; y: number } | null>(null);
    const [armado, setArmado] = useState(false);
    const [mandando, setMandando] = useState<string | null>(null);
    const volo = useRef(false);
    /** Geocercas: la lista, si su panel está abierto, y la que se está dibujando o corrigiendo. */
    const [cercas, setCercas] = useState<Geocerca[]>([]);
    const [panelCercas, setPanelCercas] = useState(false);
    const [borrador, setBorrador] = useState<Borrador | null>(null);
    /** Esperando un clic en el mapa para poner el centro de una geocerca nueva. */
    const [colocando, setColocando] = useState(false);
    const [guardando, setGuardando] = useState(false);
    /** El viaje resaltado dentro del recorrido a la vista. */
    const [viajeSel, setViajeSel] = useState<number | null>(null);

    const traerCercas = useCallback(async () => { try { setCercas(await geocercasGps()); } catch { /* sin permiso: no se dibujan */ } }, []);
    useEffect(() => { traerCercas(); }, [traerCercas]);

    const guardarCerca = async () => {
        if (!borrador) return;
        setGuardando(true);
        try {
            const x = await guardarGeocercaGps({ id: borrador.id, nombre: borrador.nombre, lat: borrador.lat, lon: borrador.lon, radio: borrador.radio, imeis: borrador.imeis, activa: borrador.activa });
            if (!x.ok) { toast.error({ title: "No se guardó", description: x.error }); return; }
            toast.success({ title: "Geocerca guardada", description: "Empieza a valer en menos de un minuto." });
            setBorrador(null); traerCercas();
        } finally { setGuardando(false); }
    };

    const traer = useCallback(async () => {
        /* Sólo los dados de alta. Uno que se presentó solo todavía no es de nadie: el puerto
           está abierto a internet, y un IMEI inventado con una posición inventada no tiene que
           poder dibujarse en el mapa de operación. Se acepta primero en Dispositivos. */
        try { setLista((await rastreadoresGps()).filter((r) => r.deviceId && r.lat !== null && r.lon !== null)); }
        catch { /* sin permiso o sin red: la capa no se dibuja y el mapa sigue andando */ }
    }, []);
    useEffect(() => { traer(); const iv = setInterval(traer, REFRESCO_MS); return () => clearInterval(iv); }, [traer]);

    const verRuta = useCallback(async (imei: string, horas: number, encuadrar = true) => {
        if (encuadrar) setViajeSel(null);
        setRuta((v) => ({ imei, horas, datos: v && v.imei === imei && v.horas === horas ? v.datos : null }));
        try {
            const datos = await recorridoGps(imei, horas);
            setRuta((v) => (v && v.imei === imei && v.horas === horas ? { ...v, datos } : v));
            if (encuadrar && datos.puntos.length > 1) mapa.fitBounds(L.latLngBounds(datos.puntos.map((p) => [p.lat, p.lon] as [number, number])), { padding: [60, 60], maxZoom: 17 });
        } catch { toast.error({ title: "No se pudo traer el recorrido" }); }
    }, [mapa]);

    /* El recorrido a la vista se vuelve a pedir con cada refresco, sin reencuadrar: si el vehículo
       está andando, la línea crece sola y el mapa no salta. */
    const rutaRef = useRef(ruta); rutaRef.current = ruta;
    useEffect(() => { const r = rutaRef.current; if (r) verRuta(r.imei, r.horas, false); }, [lista, verRuta]);

    /* Llegar con ?gps=<imei> (desde Dispositivos) lleva el mapa al rastreador, una sola vez. */
    useEffect(() => {
        if (volo.current || !lista.length) return;
        let pedido: string | null = null;
        try { pedido = new URLSearchParams(window.location.search).get("gps"); } catch { /* sin URL */ }
        const r = pedido ? lista.find((x) => x.imei === pedido) : null;
        if (!r) return;
        volo.current = true;
        mapa.setView([r.lat!, r.lon!], 17);
        verRuta(r.imei, 24, false);
    }, [lista, mapa, verRuta]);

    /* El menú se cierra con Escape, con un clic afuera o al mover el mapa. */
    useEffect(() => {
        if (!menu) { setArmado(false); return; }
        const cerrar = () => setMenu(null);
        const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") cerrar(); };
        window.addEventListener("click", cerrar); window.addEventListener("keydown", tecla);
        mapa.on("movestart zoomstart", cerrar);
        return () => { window.removeEventListener("click", cerrar); window.removeEventListener("keydown", tecla); mapa.off("movestart zoomstart", cerrar); };
    }, [menu, mapa]);
    useEffect(() => { if (!armado) return; const t = setTimeout(() => setArmado(false), 5000); return () => clearTimeout(t); }, [armado]);

    const mandar = async (imei: string, accion: ComandoGps) => {
        setMandando(accion); setArmado(false);
        try {
            const x = await comandoGps(imei, accion);
            const titulo = accion === "rele.accionar" ? "Relé accionado" : accion === "rele.soltar" ? "Relé en reposo" : "El equipo contestó";
            /* Se muestra lo que contestó EL EQUIPO, textual: es la única palabra que vale. */
            if (!x.ok) toast.error({ title: accion.startsWith("rele.") ? "No se accionó" : "No contestó", description: x.error });
            else toast.success({ title: titulo, description: x.respuesta });
            traer();
        } finally { setMandando(null); setMenu(null); }
    };

    if (!lista.length) return null;
    const delMenu = menu ? lista.find((r) => r.imei === menu.imei) : null;
    const pts = ruta?.datos?.puntos || [];
    const deLaRuta = ruta ? lista.find((r) => r.imei === ruta.imei) : null;
    const viajes = ruta?.datos?.viajes || [];
    const paradas = ruta?.datos?.paradas || [];
    /* El viaje elegido se dibuja con los puntos del recorrido que caen en su horario. */
    const elViaje = viajeSel !== null ? viajes[viajeSel] : null;
    const ptsViaje = elViaje ? pts.filter((p) => p.cuando >= elViaje.desde && p.cuando <= elViaje.hasta) : [];
    const verViaje = (i: number) => {
        const v = viajes[i]; if (!v) return;
        setViajeSel(i === viajeSel ? null : i);
        const suyos = pts.filter((p) => p.cuando >= v.desde && p.cuando <= v.hasta);
        if (suyos.length > 1) mapa.fitBounds(L.latLngBounds(suyos.map((p) => [p.lat, p.lon] as [number, number])), { padding: [60, 60], maxZoom: 17 });
    };

    return (
        <>
            {pts.length > 1 && (
                <>
                    {/* Un borde oscuro debajo: sobre el satélite, una línea celeste sola se pierde. */}
                    <Polyline positions={pts.map((p) => [p.lat, p.lon] as [number, number])} pathOptions={{ color: "#0a0e14", weight: 7, opacity: 0.55, lineCap: "round", lineJoin: "round" }} />
                    <Polyline positions={pts.map((p) => [p.lat, p.lon] as [number, number])} pathOptions={{ color: CELESTE, weight: 4, opacity: 0.95, lineCap: "round", lineJoin: "round" }} />
                    {/* De dónde salió: un aro. El final es el propio rastreador. */}
                    <CircleMarker center={[pts[0].lat, pts[0].lon]} radius={6} pathOptions={{ color: "#fff", weight: 3, fillColor: CELESTE, fillOpacity: 1 }} />
                </>
            )}

            {/* El viaje elegido, encima del recorrido: el resto queda de fondo. */}
            {ptsViaje.length > 1 && (
                <Polyline positions={ptsViaje.map((p) => [p.lat, p.lon] as [number, number])} pathOptions={{ color: "#fbbf24", weight: 6, opacity: 1, lineCap: "round", lineJoin: "round" }} />
            )}
            {/* Las paradas: dónde quedó entre un viaje y otro, y cuánto. */}
            {paradas.map((pa, i) => (
                <Marker key={`pa-${i}`} position={[pa.lat, pa.lon]} zIndexOffset={1200} interactive={false}
                    icon={L.divIcon({ className: "bg-transparent border-0", iconSize: [64, 20], iconAnchor: [32, 10],
                        html: `<div style="padding:1px 7px;border-radius:999px;background:#0a0e14;color:#fff;border:2px solid ${CELESTE};font:700 10.5px/14px Outfit,system-ui,sans-serif;white-space:nowrap;text-align:center">P · ${duracion(pa.minutos)}</div>` })} />
            ))}

            {/* Las geocercas. La que se está corrigiendo se dibuja como borrador, no dos veces. */}
            {cercas.filter((c) => c.id !== borrador?.id).map((c) => (
                <Circle key={c.id} center={[c.lat, c.lon]} radius={c.radio}
                    pathOptions={{ color: c.activa ? "#a78bfa" : GRIS, weight: 2, dashArray: c.activa ? undefined : "6 6", fillColor: c.activa ? "#a78bfa" : GRIS, fillOpacity: 0.12 }}
                    eventHandlers={{ click: () => { setBorrador({ ...c }); setPanelCercas(true); } }} />
            ))}
            {borrador && (
                <>
                    <Circle center={[borrador.lat, borrador.lon]} radius={borrador.radio} pathOptions={{ color: "#fbbf24", weight: 2.5, dashArray: "8 6", fillColor: "#fbbf24", fillOpacity: 0.14 }} />
                    <Marker position={[borrador.lat, borrador.lon]} draggable zIndexOffset={1800}
                        icon={L.divIcon({ className: "bg-transparent border-0", iconSize: [18, 18], iconAnchor: [9, 9], html: '<div style="width:18px;height:18px;border-radius:50%;background:#fbbf24;border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.5)"></div>' })}
                        eventHandlers={{ dragend: (e) => { const ll = (e.target as L.Marker).getLatLng(); setBorrador((b) => (b ? { ...b, lat: ll.lat, lon: ll.lng } : b)); } }} />
                </>
            )}
            {colocando && <ClicEnElMapa alTocar={(lat, lon) => { setColocando(false); setBorrador({ nombre: "", lat, lon, radio: 200, imeis: [], activa: true }); setPanelCercas(true); }} />}

            {lista.map((r) => (
                <Marker key={r.imei} position={[r.lat!, r.lon!]} icon={icono(r)} zIndexOffset={1500}
                    eventHandlers={{
                        contextmenu: (e) => {
                            const oe = (e as unknown as { originalEvent: MouseEvent }).originalEvent;
                            oe.preventDefault(); oe.stopPropagation();
                            mapa.closePopup();
                            setMenu({ imei: r.imei, x: Math.min(oe.clientX, window.innerWidth - 250), y: Math.min(oe.clientY, window.innerHeight - 380) });
                        },
                    }}>
                    <Popup>
                        <div style={{ font: "13px/1.45 Outfit,system-ui,sans-serif", minWidth: 215 }}>
                            <div style={{ fontWeight: 700, fontSize: 14 }}>{r.nombre || `Rastreador ${r.imei.slice(-6)}`}</div>
                            <div style={{ color: "#64748b", fontSize: 11.5, marginBottom: 6 }}>{r.matricula ? `${r.matricula} · ` : ""}IMEI {r.imei}</div>
                            <Renglon k="Estado" v={r.enLinea ? `En línea · reportó ${hace(r.ultimoLatido)}` : `Sin reportar desde ${hace(r.ultimoLatido, "nunca")}`} />
                            <Renglon k="Posición" v={`de ${hace(r.cuando)}`} aviso={tonoDe(r) === AMBAR ? "sin satélites desde entonces" : undefined} />
                            <Renglon k="Motor" v={r.encendido === null ? "—" : r.encendido ? "Encendido" : "Apagado"} />
                            <Renglon k="Velocidad" v={`${r.velocidad || 0} km/h`} />
                            <Renglon k="Batería del vehículo" v={r.voltaje !== null ? `${r.voltaje.toFixed(1).replace(".", ",")} V` : "—"} />
                            <Renglon k="Relé" v={r.cortado === null ? "—" : r.cortado ? "Accionado" : "En reposo"} />
                            <div style={{ color: "#64748b", fontSize: 11.5, marginTop: 6 }}>Clic derecho: recorrido, controles e ícono.</div>
                        </div>
                    </Popup>
                </Marker>
            ))}

            {/* El menú y el panel van afuera del mapa (portal): adentro, Leaflet les roba los clics. */}
            {typeof document !== "undefined" && createPortal(
                <>
                    {menu && delMenu && (
                        <div className="fixed z-[600] bg-popover border border-border rounded-lg shadow-xl py-1 text-xs min-w-[230px]" style={{ left: menu.x, top: menu.y }}
                            onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
                            <p className="px-3 pt-1.5 pb-1 text-[12.5px] font-bold truncate">{delMenu.nombre || `Rastreador ${delMenu.imei.slice(-6)}`}</p>
                            <p className="px-3 pb-1.5 text-[10.5px] text-muted-foreground border-b border-border">{delMenu.enLinea ? `En línea · reportó ${hace(delMenu.ultimoLatido)}` : "Sin reportar"}</p>

                            <Rotulo>Recorrido</Rotulo>
                            <div className="px-3 pb-1.5 flex gap-1">
                                {TRAMOS.map((t) => (
                                    <button key={t.horas} type="button" onClick={() => { verRuta(delMenu.imei, t.horas); setMenu(null); }}
                                        className={cn("h-6 px-2 rounded-full border text-[11px] font-semibold", ruta?.imei === delMenu.imei && ruta.horas === t.horas ? "bg-foreground text-background border-foreground" : "border-border hover:bg-accent")}>{t.rotulo}</button>
                                ))}
                            </div>
                            {ruta?.imei === delMenu.imei && <Item icono={EyeOff} onClick={() => { setRuta(null); setMenu(null); }}>Ocultar el recorrido</Item>}
                            <Item icono={Crosshair} onClick={() => { mapa.setView([delMenu.lat!, delMenu.lon!], Math.max(mapa.getZoom(), 17)); setMenu(null); }}>Centrar acá</Item>

                            <Rotulo>Controles</Rotulo>
                            <Item icono={Radio} cargando={mandando === "estado"} apagado={!delMenu.enLinea || !!mandando} onClick={() => mandar(delMenu.imei, "estado")}>Preguntarle el estado</Item>
                            <Item icono={MapPin} cargando={mandando === "posicion"} apagado={!delMenu.enLinea || !!mandando} onClick={() => mandar(delMenu.imei, "posicion")}>Pedirle la posición</Item>
                            {delMenu.cortado ? (
                                <Item icono={ToggleLeft} cargando={mandando === "rele.soltar"} apagado={!delMenu.enLinea || !!mandando} onClick={() => mandar(delMenu.imei, "rele.soltar")}>Soltar el relé</Item>
                            ) : armado ? (
                                <Item icono={ToggleRight} peligro onClick={() => mandar(delMenu.imei, "rele.accionar")}>¿Confirmar? Accionar el relé</Item>
                            ) : (
                                <Item icono={ToggleRight} cargando={mandando === "rele.accionar"} apagado={!delMenu.enLinea || !!mandando} onClick={() => setArmado(true)}>Accionar el relé…</Item>
                            )}

                            <Rotulo>Geocercas</Rotulo>
                            <Item icono={Plus} onClick={() => { setBorrador({ nombre: "", lat: delMenu.lat!, lon: delMenu.lon!, radio: 200, imeis: [], activa: true }); setPanelCercas(true); setMenu(null); }}>Nueva alrededor de acá</Item>
                            <Item icono={CircleDashed} onClick={() => { setPanelCercas(true); setMenu(null); }}>Ver las geocercas{cercas.length ? ` (${cercas.length})` : ""}</Item>

                            <Rotulo>Ícono</Rotulo>
                            <div className="px-3 pb-1.5 flex gap-1">
                                {Object.entries(ICONOS).map(([clave, i]) => (
                                    <button key={clave} type="button" title={i.rotulo}
                                        onClick={async () => { const x = await cambiarIconoGps(delMenu.imei, clave); if (!x.ok) toast.error({ title: "No se pudo cambiar", description: x.error }); traer(); }}
                                        className={cn("h-8 w-8 grid place-items-center rounded-md border", (delMenu.icono || "auto") === clave ? "border-[var(--accion)] bg-[var(--accion)]" : "border-border bg-foreground/80 hover:bg-foreground")}
                                        dangerouslySetInnerHTML={{ __html: trazo(i.svg, 16) }} />
                                ))}
                            </div>

                            <div className="border-t border-border mt-1 pt-1">
                                <Link href="/admin/devices?type=GPS" className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"><Server size={13} className="text-muted-foreground" /> Ver en Dispositivos</Link>
                            </div>
                        </div>
                    )}

                    {ruta && deLaRuta && (
                        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[500] w-[min(560px,calc(100vw-32px))] rounded-[14px] border border-border bg-popover shadow-xl px-4 py-3">
                            <div className="flex items-center gap-2">
                                <Route size={15} className="text-muted-foreground shrink-0" />
                                <p className="text-[13px] font-bold truncate flex-1">Recorrido de {deLaRuta.nombre || deLaRuta.matricula || deLaRuta.imei.slice(-6)}</p>
                                <div className="flex gap-1">
                                    {TRAMOS.map((t) => (
                                        <button key={t.horas} type="button" onClick={() => verRuta(ruta.imei, t.horas)}
                                            className={cn("h-6 px-2 rounded-full border text-[11px] font-semibold", ruta.horas === t.horas ? "bg-foreground text-background border-foreground" : "border-border hover:bg-accent")}>{t.rotulo}</button>
                                    ))}
                                </div>
                                <button type="button" onClick={() => setRuta(null)} aria-label="Cerrar el recorrido" className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:bg-accent"><X size={14} /></button>
                            </div>
                            {!ruta.datos ? (
                                <p className="mt-2 text-[12px] text-muted-foreground inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Trayendo el recorrido…</p>
                            ) : ruta.datos.resumen.puntos < 2 ? (
                                <p className="mt-2 text-[12px] text-muted-foreground">No hay posiciones con satélites en ese tramo.</p>
                            ) : (
                                <dl className="mt-2 grid grid-cols-4 gap-3 text-[12.5px]">
                                    <Cifra k="Recorrió" v={`${ruta.datos.resumen.km.toFixed(1).replace(".", ",")} km`} />
                                    <Cifra k="En movimiento" v={ruta.datos.resumen.enMovimientoMin >= 60 ? `${Math.floor(ruta.datos.resumen.enMovimientoMin / 60)} h ${ruta.datos.resumen.enMovimientoMin % 60} min` : `${ruta.datos.resumen.enMovimientoMin} min`} />
                                    <Cifra k="Velocidad máxima" v={`${ruta.datos.resumen.velMax} km/h`} />
                                    <Cifra k="Desde" v={fechaHora(ruta.datos.resumen.desde)} />
                                </dl>
                            )}
                            {viajes.length > 0 && (
                                <div className="mt-2.5 border-t border-border pt-2">
                                    <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1">
                                        {viajes.length} {viajes.length === 1 ? "viaje" : "viajes"}{paradas.length ? ` · ${paradas.length} ${paradas.length === 1 ? "parada" : "paradas"}` : ""}
                                    </p>
                                    <ul className="max-h-[132px] overflow-y-auto [scrollbar-width:thin] -mx-1">
                                        {viajes.map((v, i) => (
                                            <li key={v.desde}>
                                                <button type="button" onClick={() => verViaje(i)}
                                                    className={cn("w-full flex items-center gap-3 px-2 py-1 rounded-[6px] text-left text-[12px] tabular-nums", viajeSel === i ? "bg-amber-400/20" : "hover:bg-accent")}>
                                                    <span className="font-bold w-[92px] shrink-0">{hora(v.desde)} → {hora(v.hasta)}</span>
                                                    <span className="w-[62px] shrink-0">{v.km.toFixed(1).replace(".", ",")} km</span>
                                                    <span className="w-[58px] shrink-0 text-muted-foreground">{duracion(v.minutos)}</span>
                                                    <span className="text-muted-foreground truncate">máx {v.velMax} km/h · media {v.velMedia}</span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}

                    {panelCercas && (
                        <div className="fixed top-20 right-4 z-[500] w-[300px] max-h-[calc(100vh-120px)] flex flex-col rounded-[14px] border border-border bg-popover shadow-xl"
                            onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-border">
                                <CircleDashed size={15} className="text-muted-foreground" />
                                <p className="text-[13px] font-bold flex-1">Geocercas</p>
                                <button type="button" onClick={() => { setPanelCercas(false); setBorrador(null); setColocando(false); }} aria-label="Cerrar" className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:bg-accent"><X size={14} /></button>
                            </div>

                            {borrador ? (
                                <div className="px-4 py-3 space-y-2.5">
                                    <label className="block">
                                        <span className="block text-[11px] text-muted-foreground mb-1">Nombre (es lo que dice el aviso)</span>
                                        <input autoFocus value={borrador.nombre} onChange={(e) => setBorrador({ ...borrador, nombre: e.target.value })} placeholder="Ej. Base, Taller, Casa"
                                            className="h-8 w-full px-2.5 rounded-[6px] border border-border bg-background text-[12.5px]" />
                                    </label>
                                    <label className="block">
                                        <span className="flex justify-between text-[11px] text-muted-foreground mb-1"><span>Radio</span><b className="text-foreground tabular-nums">{borrador.radio >= 1000 ? `${(borrador.radio / 1000).toFixed(1).replace(".", ",")} km` : `${borrador.radio} m`}</b></span>
                                        {/* La escala no es pareja: entre 50 y 500 m se necesita precisión; a 5 km, no. */}
                                        <input type="range" min={0} max={RADIOS.length - 1} step={1} value={indiceDeRadio(borrador.radio)}
                                            onChange={(e) => setBorrador({ ...borrador, radio: RADIOS[Number(e.target.value)] })} className="w-full" />
                                    </label>
                                    <label className="flex items-center gap-2 text-[12px]">
                                        <input type="checkbox" checked={borrador.activa} onChange={(e) => setBorrador({ ...borrador, activa: e.target.checked })} /> Avisar cuando entren o salgan
                                    </label>
                                    <p className="text-[11px] text-muted-foreground leading-snug">Arrastrá el punto amarillo para mover el centro. Vale para todos los rastreadores.</p>
                                    <div className="flex items-center gap-2 pt-1">
                                        {borrador.id && <DeleteButton onConfirm={async () => { await borrarGeocercaGps(borrador.id!); setBorrador(null); traerCercas(); }} />}
                                        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setBorrador(null)}>Cancelar</Button>
                                        <Button size="sm" disabled={guardando || !borrador.nombre.trim()} onClick={guardarCerca}>{guardando && <Loader2 size={13} className="animate-spin" />} Guardar</Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="px-2 py-2 overflow-y-auto [scrollbar-width:thin]">
                                    {cercas.length === 0 && <p className="px-2 py-2 text-[12px] text-muted-foreground">Todavía no hay ninguna. Una geocerca es una zona que avisa cuando un vehículo entra o sale.</p>}
                                    {cercas.map((c) => (
                                        <button key={c.id} type="button" onClick={() => { setBorrador({ ...c }); mapa.fitBounds(L.latLng(c.lat, c.lon).toBounds(c.radio * 2.4)); }}
                                            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[6px] text-left hover:bg-accent">
                                            <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", c.activa ? "bg-violet-400" : "bg-muted-foreground/40")} />
                                            <span className="text-[12.5px] font-semibold truncate flex-1">{c.nombre}</span>
                                            <span className="text-[11px] text-muted-foreground tabular-nums">{c.radio >= 1000 ? `${(c.radio / 1000).toFixed(1).replace(".", ",")} km` : `${c.radio} m`}</span>
                                        </button>
                                    ))}
                                    <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => setColocando(true)} disabled={colocando}>
                                        <Plus size={13} /> {colocando ? "Tocá el mapa donde va el centro…" : "Nueva: tocar el mapa"}
                                    </Button>
                                    <p className="px-2 pt-2 text-[11px] text-muted-foreground leading-snug">Para que avise, armá una regla de GPS con «Entró» o «Salió de una geocerca» en Notificaciones.</p>
                                </div>
                            )}
                        </div>
                    )}
                </>,
                document.body,
            )}
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
const Rotulo = ({ children }: { children: React.ReactNode }) => (
    <p className="px-3 pt-2 pb-1 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{children}</p>
);
function Item({ icono: Ico, children, onClick, apagado, cargando, peligro }: { icono: typeof Radio; children: React.ReactNode; onClick: () => void; apagado?: boolean; cargando?: boolean; peligro?: boolean }) {
    return (
        <button type="button" onClick={onClick} disabled={apagado}
            className={cn("w-full text-left px-3 py-1.5 flex items-center gap-2 disabled:opacity-40", peligro ? "pleno-mal font-bold" : "hover:bg-accent")}>
            {cargando ? <Loader2 size={13} className="animate-spin" /> : <Ico size={13} className={peligro ? "" : "text-muted-foreground"} />} {children}
        </button>
    );
}
function Cifra({ k, v }: { k: string; v: string }) {
    return <div className="min-w-0"><dt className="text-[10.5px] text-muted-foreground">{k}</dt><dd className="font-bold tabular-nums truncate">{v}</dd></div>;
}

/** Una geocerca a medio dibujar o corrigiéndose: sin `id` todavía no existe. */
type Borrador = { id?: string; nombre: string; lat: number; lon: number; radio: number; imeis: string[]; activa: boolean };

/** Los radios que ofrece la barra, en metros. */
const RADIOS = [50, 75, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000];
const indiceDeRadio = (r: number) => { let m = 0; RADIOS.forEach((x, i) => { if (Math.abs(x - r) < Math.abs(RADIOS[m] - r)) m = i; }); return m; };

const duracion = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`);

/** Espera UN clic en el mapa. Vive adentro del mapa porque es el mapa el que sabe dónde se tocó. */
function ClicEnElMapa({ alTocar }: { alTocar: (lat: number, lon: number) => void }) {
    useMapEvents({ click: (e) => alTocar(e.latlng.lat, e.latlng.lng) });
    return null;
}
