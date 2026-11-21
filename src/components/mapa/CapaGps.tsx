"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Circle, CircleMarker, Marker, Polyline, Popup, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { CircleDashed, Crosshair, EyeOff, History, Loader2, LocateFixed, MapPin, Plus, Radio, Route, Server, ToggleLeft, ToggleRight, X } from "lucide-react";
import { sileo as toast } from "sileo";
import {
    borrarGeocercaGps, cambiarIconoGps, comandoGps, entornoEventoGps, estelaGps, geocercasGps, guardarGeocercaGps, rastreadoresGps, recorridoGps, unEventoGps,
    type ComandoGps, type EventoGps, type Geocerca, type PuntoGps, type Rastreador, type RecorridoGps,
} from "@/app/actions/gps";
import { CajonEventosGps } from "@/components/mapa/CajonEventosGps";
import { demoraLegible, fichaDeEventoGps, tituloDeEventoGps } from "@/lib/gps-eventos";
import { useTiempoReal } from "@/lib/tiempo-real";
import { metrosEntre, resumenDeRecorrido } from "@/lib/gps-recorrido";
import { posicionEn, RETRASO_MS } from "@/lib/gps-reproducir";
import { Button } from "@/components/ui/button";
import { DeleteButton } from "@/components/ui/delete-button";
import { fechaCorta, fechaHora, hace, hora, horaSeg } from "@/lib/fechas";
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
 *  · **Gris con aro rojo cortado y «sin reportar»** — se avisó que dejó de reportar (el receptor
 *    lo detecta, ver lib-gps-eventos). No es lo mismo que el gris: ése es un equipo del que hace
 *    rato no se sabe; éste es uno que se calló cuando no debía.
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
/** Una lista vacía que es siempre LA MISMA: si fuera una nueva en cada render, react-leaflet vaciaría la línea. */
const SIN_PUNTOS: [number, number][] = [];

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
    const callado = !!r.sinReporteDesde;
    /* La flecha de rumbo va AFUERA del círculo y sólo si se está moviendo: un vehículo quieto no
       tiene rumbo, y el que informa el equipo parado es el último que tuvo. */
    const flecha = andando
        ? `<div class="gps-rumbo" style="position:absolute;inset:-9px;transform:rotate(${r.rumbo || 0}deg);transition:transform .6s linear;pointer-events:none"><div style="margin:0 auto;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:10px solid ${c}"></div></div>`
        : "";
    /* La velocidad, encima, sólo si se está moviendo. El NÚMERO no se escribe acá para siempre:
       el ícono no se rehace con cada cambio de velocidad (parpadearía), así que `MarcadorGps`
       busca `.gps-vel-n` y lo va llevando de un valor al otro. */
    const cartel = andando
        ? `<div class="gps-vel" style="position:absolute;left:50%;bottom:calc(100% + 13px);padding:2px 9px;border-radius:999px;background:#0a0e14;color:#fff;border:2px solid ${c};box-shadow:0 2px 8px rgba(0,0,0,.45);font:800 13px/17px Outfit,system-ui,sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap;pointer-events:none"><span class="gps-vel-n">${r.velocidad || 0}</span><span style="font-weight:600;font-size:10px;opacity:.75"> km/h</span></div>`
        : "";
    return L.divIcon({
        className: "bg-transparent border-0",
        html: `<div style="display:flex;flex-direction:column;align-items:center;gap:3px">
            <div style="position:relative;width:36px;height:36px">
                ${cartel}
                ${flecha}
                <div style="width:36px;height:36px;border-radius:50%;background:${c};border:3px ${callado ? "dashed" : "solid"} ${r.cortado || callado ? ROJO : "#fff"};box-shadow:0 2px 8px rgba(0,0,0,.45);display:grid;place-items:center">${trazo(dibujo.svg)}</div>
            </div>
            <div style="padding:1px 7px;border-radius:999px;background:${callado ? ROJO : "rgba(10,14,20,.85)"};color:#fff;font:700 11px/16px Outfit,system-ui,sans-serif;white-space:nowrap">${rotulo}${callado ? " · sin reportar" : ""}</div>
        </div>`,
        iconSize: [150, 62], iconAnchor: [75, 18], popupAnchor: [0, -20],
    });
}

/** Los tramos de tiempo que se ofrecen para el recorrido. */
const TRAMOS: { clave: string; rotulo: string }[] = [
    { clave: "vivo", rotulo: "En vivo" }, { clave: "10m", rotulo: "10 min" },
    { clave: "6", rotulo: "6 h" }, { clave: "24", rotulo: "24 h" }, { clave: "72", rotulo: "3 días" }, { clave: "168", rotulo: "7 días" },
];

export function CapaGps() {
    const mapa = useMap();
    const [lista, setLista] = useState<Rastreador[]>([]);
    /** El recorrido a la vista: de quién, de cuántas horas, y lo que trajo el servidor. */
    const [ruta, setRuta] = useState<{ imei: string; horas: number; datos: RecorridoGps | null } | null>(null);
    /**
     * La estela: las últimas posiciones tal cual, para «10 min» y para el modo en vivo. En vivo
     * crece con cada posición que empuja el servidor y la cámara sigue al vehículo, hasta que
     * alguien arrastra el mapa (`suelta`): quien mueve el mapa quiere mirar otra cosa, y una
     * cámara que vuelve sola a su lugar es pelearse con la mano del que mira.
     */
    const [estela, setEstela] = useState<{ imei: string; vivo: boolean; puntos: PuntoGps[] | null } | null>(null);
    const [suelta, setSuelta] = useState(false);
    const lineaBorde = useRef<L.Polyline>(null), lineaColor = useRef<L.Polyline>(null);
    const ptsEstelaRef = useRef<PuntoGps[]>([]);
    /** Hasta dónde va dibujado el vehículo de la estela: su posición y la hora del equipo que le corresponde. */
    const cabeza = useRef<{ lat: number; lon: number; t: number } | null>(null);
    const trazarEstela = useCallback(() => {
        const pts = ptsEstelaRef.current, c = cabeza.current;
        let ll: [number, number][];
        if (!c || c.t === Infinity) ll = pts.map((p) => [p.lat, p.lon]);
        else {
            const hasta = new Date(c.t).toISOString();
            ll = pts.filter((p) => p.cuando <= hasta).map((p) => [p.lat, p.lon]);
            ll.push([c.lat, c.lon]);
        }
        lineaBorde.current?.setLatLngs(ll); lineaColor.current?.setLatLngs(ll);
    }, []);
    const alMoverEstela = useCallback((lat: number, lon: number, t: number) => { cabeza.current = { lat, lon, t }; trazarEstela(); }, [trazarEstela]);
    /* Cuando cambian los puntos (o se abre la estela) se vuelve a trazar con la cabeza que haya. */
    useEffect(() => { trazarEstela(); }, [estela, trazarEstela]);
    /** La geocerca que acaba de cruzar alguien: se destaca unos segundos. */
    const [destello, setDestello] = useState<string | null>(null);
    /** El cajón de eventos: de qué rastreador. */
    const [cajon, setCajon] = useState<string | null>(null);
    /** El evento marcado en el mapa, con el tramo que el vehículo venía recorriendo alrededor. */
    const [evSel, setEvSel] = useState<{ e: EventoGps; entorno: PuntoGps[] } | null>(null);
    /** Sube cuando pasa algo que el cajón no recibe por el socket (se accionó el relé desde acá). */
    const [refrescoCajon, setRefrescoCajon] = useState(0);
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
            /* Lo que más confunde de una geocerca recién hecha: se la dibuja alrededor de un vehículo
               y «no avisa que entró». No entró: ya estaba. Se dice acá, que es cuando importa. */
            const adentro = lista.filter((r) => metrosEntre({ lat: borrador.lat, lon: borrador.lon }, { lat: r.lat!, lon: r.lon! }) <= borrador.radio).map((r) => r.nombre || r.matricula || r.imei.slice(-6));
            toast.success({
                title: "Geocerca guardada",
                description: adentro.length ? `${adentro.join(", ")} ya está adentro: el primer aviso va a ser cuando salga.` : "Empieza a valer en menos de un minuto.",
            });
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
    const traerRef = useRef(traer); traerRef.current = traer;

    const verRuta = useCallback(async (imei: string, horas: number, encuadrar = true) => {
        if (encuadrar) { setViajeSel(null); setEstela(null); }
        setRuta((v) => ({ imei, horas, datos: v && v.imei === imei && v.horas === horas ? v.datos : null }));
        try {
            const datos = await recorridoGps(imei, horas);
            setRuta((v) => (v && v.imei === imei && v.horas === horas ? { ...v, datos } : v));
            if (encuadrar && datos.puntos.length > 1) mapa.fitBounds(L.latLngBounds(datos.puntos.map((p) => [p.lat, p.lon] as [number, number])), { padding: [60, 60], maxZoom: 17 });
        } catch { toast.error({ title: "No se pudo traer el recorrido" }); }
    }, [mapa]);

    const verEstela = useCallback(async (imei: string, vivo: boolean) => {
        setRuta(null); setViajeSel(null); setSuelta(false);
        cabeza.current = null;   // la cabeza era de la estela anterior (quizá de otro vehículo)
        setEstela((v) => ({ imei, vivo, puntos: v && v.imei === imei ? v.puntos : null }));
        try {
            const puntos = await estelaGps(imei, 10);
            setEstela((v) => (v && v.imei === imei ? { ...v, puntos } : v));
            if (!vivo && puntos.length > 1) mapa.fitBounds(L.latLngBounds(puntos.map((p) => [p.lat, p.lon] as [number, number])), { padding: [80, 80], maxZoom: 17 });
        } catch { toast.error({ title: "No se pudo traer la estela" }); }
    }, [mapa]);

    /* Las posiciones llegan empujadas por el servidor apenas el equipo las manda (cada 10 s
       andando). Preguntar cada 15 s queda como respaldo, por si el socket se cae. */
    useTiempoReal<{ imei: string; lat: number; lon: number; velocidad: number; rumbo: number; cuando: string }>("gps_posicion", (d) => {
        setLista((v) => v.map((r) => (r.imei === d.imei ? { ...r, lat: d.lat, lon: d.lon, velocidad: d.velocidad, rumbo: d.rumbo, cuando: d.cuando, enLinea: true, ultimoLatido: d.cuando } : r)));
        setEstela((v) => {
            if (!v || v.imei !== d.imei || !v.puntos) return v;
            if (v.puntos.length && v.puntos[v.puntos.length - 1].cuando >= d.cuando) return v;
            const corte = new Date(Date.now() - 10 * 60_000).toISOString();
            return { ...v, puntos: [...v.puntos.filter((p) => p.cuando >= corte), { lat: d.lat, lon: d.lon, cuando: d.cuando, velocidad: d.velocidad }] };
        });
    });

    /* Lo que le pasa a un rastreador se ve en el mapa en el momento, haya o no una regla de
       notificación: el aviso por Telegram es para quien no está mirando. */
    useTiempoReal<{ imei: string; tipo: string; rotulo: string; detalle: string; nombre: string; geocercaId?: string; tarde?: number; lugar?: string | null }>("gps_evento", (d) => {
        const cruce = d.tipo === "GPS_GEOCERCA_ENTRA" || d.tipo === "GPS_GEOCERCA_SALE";
        const tono = fichaDeEventoGps(d.tipo).tono;
        /* Lo que llegó tarde se dice: «entró a Base» de hace diez minutos no es «está entrando». */
        const demora = demoraLegible(d.tarde);
        const resto = [cruce ? null : d.detalle, d.lugar, demora ? `pasó hace ${demora}` : null].filter(Boolean).join(" · ");
        toast[tono === "mal" ? "error" : tono === "aviso" ? "warning" : "success"]({
            title: cruce ? `${d.nombre} ${d.tipo === "GPS_GEOCERCA_ENTRA" ? "entró a" : "salió de"} «${d.detalle}»` : `${d.nombre}: ${fichaDeEventoGps(d.tipo).rotulo}`,
            description: resto || undefined,
        });
        /* Un cruce atrasado no enciende la geocerca: ya no está pasando. */
        if (d.geocercaId && !demora) { setDestello(d.geocercaId); setTimeout(() => setDestello((x) => (x === d.geocercaId ? null : x)), 8000); }
        if (d.tipo === "GPS_SIN_REPORTE" || d.tipo === "GPS_VOLVIO") traerRef.current();
    });

    /**
     * Ir a donde pasó un evento. El punto queda centrado en la parte del mapa QUE SE VE: con el
     * cajón abierto a la derecha, centrarlo en el mapa entero lo dejaba a medias tapado.
     */
    const irAlEvento = useCallback((lat: number, lon: number) => {
        const z = Math.max(mapa.getZoom(), 17);
        const cont = mapa.getContainer().getBoundingClientRect();
        const caj = document.querySelector<HTMLElement>("[data-cajon-gps]")?.getBoundingClientRect();
        const tapado = caj ? Math.max(0, Math.min(cont.right, caj.right) - Math.max(cont.left, caj.left)) : 0;
        const centro = mapa.unproject(mapa.project([lat, lon], z).add([tapado / 2, 0]), z);
        const quieto = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (quieto) mapa.setView(centro, z); else mapa.flyTo(centro, z, { duration: 0.7 });
    }, [mapa]);

    const elegirEvento = useCallback((e: EventoGps | null) => {
        if (!e) { setEvSel(null); return; }
        setSuelta(true);                       // quien va a mirar un evento no quiere que la cámara vuelva al vehículo
        setEvSel({ e, entorno: [] });
        if (e.lat === null || e.lon === null) return;
        irAlEvento(e.lat, e.lon);
        entornoEventoGps(e.imei, e.cuando, 5).then((entorno) => setEvSel((v) => (v && v.e.id === e.id ? { ...v, entorno } : v))).catch(() => { /* sin el tramo queda el pin, que es lo que importa */ });
    }, [irAlEvento]);
    const abrirCajon = useCallback((imei: string) => { setPanelCercas(false); setBorrador(null); setColocando(false); setEvSel(null); setCajon(imei); }, []);

    /* Arrastrar el mapa suelta la cámara del modo en vivo. */
    useEffect(() => {
        const soltar = () => setSuelta(true);
        mapa.on("dragstart", soltar);
        return () => { mapa.off("dragstart", soltar); };
    }, [mapa]);

    /* El recorrido a la vista se vuelve a pedir con cada refresco, sin reencuadrar: si el vehículo
       está andando, la línea crece sola y el mapa no salta. */
    const rutaRef = useRef(ruta); rutaRef.current = ruta;
    const cadaRefresco = useRef(0);
    useEffect(() => {
        /* Sólo con el refresco por tiempo (cada 15 s), no con cada posición que empuja el socket:
           `lista` cambia en los dos casos, y volver a pedir el recorrido diez veces por minuto no
           suma nada. */
        const ahora = Date.now();
        if (ahora - cadaRefresco.current < REFRESCO_MS - 1000) return;
        cadaRefresco.current = ahora;
        const r = rutaRef.current; if (r) verRuta(r.imei, r.horas, false);
    }, [lista, verRuta]);

    /* Llegar con ?gps=<imei> (desde Dispositivos) lleva el mapa al rastreador, una sola vez. */
    useEffect(() => {
        if (volo.current || !lista.length) return;
        let pedido: string | null = null;
        try { pedido = new URLSearchParams(window.location.search).get("gps"); } catch { /* sin URL */ }
        const r = pedido ? lista.find((x) => x.imei === pedido) : null;
        if (!r) return;
        volo.current = true;
        let evento: string | null = null;
        try { evento = new URLSearchParams(window.location.search).get("evento"); } catch { /* sin URL */ }
        if (evento) {
            /* Desde Gestión de alarmas: se llega con el evento ya marcado y su historial abierto. */
            abrirCajon(r.imei);
            unEventoGps(evento).then((e) => { if (e && e.imei === r.imei) elegirEvento(e); else mapa.setView([r.lat!, r.lon!], 17); }).catch(() => mapa.setView([r.lat!, r.lon!], 17));
            return;
        }
        mapa.setView([r.lat!, r.lon!], 17);
        let soloEventos = false;
        try { soloEventos = new URLSearchParams(window.location.search).get("eventos") === "1"; } catch { /* sin URL */ }
        if (soloEventos) abrirCajon(r.imei); else verRuta(r.imei, 24, false);
    }, [lista, mapa, verRuta, abrirCajon, elegirEvento]);

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
            traer(); if (accion.startsWith("rele.")) setRefrescoCajon((n) => n + 1);
        } finally { setMandando(null); setMenu(null); }
    };

    if (!lista.length) return null;
    const delMenu = menu ? lista.find((r) => r.imei === menu.imei) : null;
    const pts = ruta?.datos?.puntos || [];
    const deLaRuta = ruta ? lista.find((r) => r.imei === ruta.imei) : estela ? lista.find((r) => r.imei === estela.imei) : null;
    const ptsEstela = estela?.puntos || [];
    ptsEstelaRef.current = ptsEstela;
    const cuentaEstela = resumenDeRecorrido(ptsEstela);
    /** A quién sigue la cámara: al del modo en vivo, mientras nadie haya arrastrado el mapa. */
    const seguido = estela?.vivo && !suelta ? estela.imei : null;
    /** Qué se ve ahora, para marcar el botón: «vivo», «10m» o las horas del recorrido. */
    const queSeVe = (imei: string): string | null => (estela?.imei === imei ? (estela.vivo ? "vivo" : "10m") : ruta?.imei === imei ? String(ruta.horas) : null);
    const elegirTramo = (imei: string, clave: string) => { if (clave === "vivo") verEstela(imei, true); else if (clave === "10m") verEstela(imei, false); else verRuta(imei, Number(clave)); };
    const cerrarRecorrido = () => { setRuta(null); setEstela(null); };
    /** Quién está adentro de cada geocerca ahora, calculado acá con las posiciones a la vista. */
    const adentroDe = (c: Geocerca) => lista.filter((r) => metrosEntre({ lat: c.lat, lon: c.lon }, { lat: r.lat!, lon: r.lon! }) <= c.radio);
    const viajes = ruta?.datos?.viajes || [];
    const paradas = ruta?.datos?.paradas || [];
    /* Los puntos de cada viaje, por su horario: cada uno es su propia línea. */
    const tramos = viajes.map((v) => pts.filter((p) => p.cuando >= v.desde && p.cuando <= v.hasta));
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
            {/* Una línea POR VIAJE. Unirlas todas dibujaba, entre el final de un viaje y el arranque
                del siguiente, una recta que nadie recorrió. */}
            {tramos.map((t, i) => t.length > 1 && (
                <React.Fragment key={`tr-${i}`}>
                    {/* Un borde oscuro debajo: sobre el satélite, una línea celeste sola se pierde. */}
                    <Polyline positions={t.map((p) => [p.lat, p.lon] as [number, number])} pathOptions={{ color: "#0a0e14", weight: 7, opacity: 0.55, lineCap: "round", lineJoin: "round" }} />
                    <Polyline positions={t.map((p) => [p.lat, p.lon] as [number, number])} pathOptions={{ color: CELESTE, weight: 4, opacity: 0.95, lineCap: "round", lineJoin: "round" }} />
                </React.Fragment>
            ))}
            {/* De dónde salió el primero: un aro. */}
            {pts.length > 1 && <CircleMarker center={[pts[0].lat, pts[0].lon]} radius={6} pathOptions={{ color: "#fff", weight: 3, fillColor: CELESTE, fillOpacity: 1 }} />}

            {/* La estela de los últimos minutos (10 min y en vivo): una sola línea, tal cual. */}
            {/* Las dos líneas se dibujan a mano (`trazarEstela`): la estela termina donde está DIBUJADO
                el vehículo, que va trece segundos detrás de la última posición. Si la línea llegara
                hasta la última, el auto andaría persiguiendo una línea que ya está pintada. */}
            {estela && (
                <>
                    <Polyline ref={lineaBorde} positions={SIN_PUNTOS} pathOptions={{ color: "#0a0e14", weight: 7, opacity: 0.55, lineCap: "round", lineJoin: "round" }} />
                    <Polyline ref={lineaColor} positions={SIN_PUNTOS} pathOptions={{ color: estela.vivo ? VERDE : CELESTE, weight: 4, opacity: 0.95, lineCap: "round", lineJoin: "round" }} />
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
            {cercas.filter((c) => c.id !== borrador?.id).map((c) => {
                /* La geocerca dice sola cómo está: violeta vacía, verde con alguien adentro, y un
                   borde grueso unos segundos cuando alguien la acaba de cruzar. Antes era un
                   círculo mudo: el cruce se detectaba y se guardaba, y en el mapa no pasaba nada. */
                const dentro = c.activa ? adentroDe(c) : [];
                const color = !c.activa ? GRIS : dentro.length ? VERDE : "#a78bfa";
                const cruzada = destello === c.id;
                return (
                    <React.Fragment key={c.id}>
                        <Circle center={[c.lat, c.lon]} radius={c.radio}
                            pathOptions={{ color, weight: cruzada ? 6 : 2, dashArray: c.activa ? undefined : "6 6", fillColor: color, fillOpacity: cruzada ? 0.3 : dentro.length ? 0.16 : 0.1 }}
                            eventHandlers={{ click: () => { setBorrador({ ...c }); setPanelCercas(true); } }} />
                        {/* El rótulo va en el borde de arriba del círculo: en el centro taparía al vehículo. */}
                        <Marker position={[L.latLng(c.lat, c.lon).toBounds(c.radio * 2).getNorth(), c.lon]} interactive={false} zIndexOffset={900}
                            icon={L.divIcon({ className: "bg-transparent border-0", iconSize: [180, 20], iconAnchor: [90, 10],
                                html: `<div style="display:flex;justify-content:center"><div style="padding:1px 8px;border-radius:999px;background:${color};color:#fff;font:700 10.5px/16px Outfit,system-ui,sans-serif;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.4)">${c.nombre.replace(/[<>&]/g, "")}${dentro.length ? ` · ${dentro.length} adentro` : ""}</div></div>` })} />
                    </React.Fragment>
                );
            })}
            {borrador && (
                <>
                    <Circle center={[borrador.lat, borrador.lon]} radius={borrador.radio} pathOptions={{ color: "#fbbf24", weight: 2.5, dashArray: "8 6", fillColor: "#fbbf24", fillOpacity: 0.14 }} />
                    <Marker position={[borrador.lat, borrador.lon]} draggable zIndexOffset={1800}
                        icon={L.divIcon({ className: "bg-transparent border-0", iconSize: [18, 18], iconAnchor: [9, 9], html: '<div style="width:18px;height:18px;border-radius:50%;background:#fbbf24;border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.5)"></div>' })}
                        eventHandlers={{ dragend: (e) => { const ll = (e.target as L.Marker).getLatLng(); setBorrador((b) => (b ? { ...b, lat: ll.lat, lon: ll.lng } : b)); } }} />
                </>
            )}
            {colocando && <ClicEnElMapa alTocar={(lat, lon) => { setColocando(false); setBorrador({ nombre: "", lat, lon, radio: 200, imeis: [], activa: true }); setPanelCercas(true); }} />}

            {/* El evento elegido en el cajón: por dónde venía (cinco minutos antes y después) y el punto
                exacto donde pasó, con qué fue y a qué hora. */}
            {evSel && evSel.entorno.length > 1 && (
                <>
                    <Polyline positions={evSel.entorno.map((p) => [p.lat, p.lon] as [number, number])} pathOptions={{ color: "#0a0e14", weight: 8, opacity: 0.5, lineCap: "round", lineJoin: "round" }} />
                    <Polyline positions={evSel.entorno.map((p) => [p.lat, p.lon] as [number, number])} pathOptions={{ color: "#fbbf24", weight: 4, opacity: 0.95, lineCap: "round", lineJoin: "round" }} />
                </>
            )}
            {evSel && evSel.e.lat !== null && evSel.e.lon !== null && (
                <Marker key={evSel.e.id} position={[evSel.e.lat, evSel.e.lon]} zIndexOffset={2200} interactive={false} icon={pinDeEvento(evSel.e)} />
            )}

            {lista.map((r) => (
                <MarcadorGps key={r.imei} r={r} seguir={seguido === r.imei} alMover={estela?.imei === r.imei ? alMoverEstela : undefined}
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
                            <Renglon icono={<Dibujo que="estado" vivo={r.enLinea} />} k="Estado" v={r.sinReporteDesde ? `Dejó de reportar ${hace(r.sinReporteDesde)}` : r.enLinea ? `En línea · reportó ${hace(r.ultimoLatido)}` : `Sin reportar desde ${hace(r.ultimoLatido, "nunca")}`} />
                            <Renglon icono={<Dibujo que="posicion" vivo={tonoDe(r) === VERDE} tono={tonoDe(r)} />} k="Posición" v={`de ${hace(r.cuando)}`} aviso={tonoDe(r) === AMBAR ? "sin satélites desde entonces" : undefined} />
                            <Renglon icono={<Dibujo que="motor" vivo={r.encendido === true} />} k="Motor" v={r.encendido === null ? "—" : r.encendido ? "Encendido" : "Apagado"} />
                            <Renglon icono={<Dibujo que="velocidad" vivo={(r.velocidad || 0) > 3} valor={r.velocidad || 0} />} k="Velocidad" v={`${r.velocidad || 0} km/h`} />
                            <Renglon icono={<Dibujo que="bateria" vivo={r.voltaje !== null && r.voltaje >= 13.2} valor={r.voltaje ?? undefined} />} k="Batería del vehículo" v={r.voltaje !== null ? `${r.voltaje.toFixed(1).replace(".", ",")} V` : "—"} />
                            <Renglon icono={<Dibujo que="rele" vivo={r.cortado === true} />} k="Relé" v={r.cortado === null ? "—" : r.cortado ? "Accionado" : "En reposo"} />
                            <button type="button" onClick={() => { mapa.closePopup(); abrirCajon(r.imei); }}
                                style={{ marginTop: 8, width: "100%", height: 28, borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", color: "#0f172a", font: "600 12px Outfit,system-ui,sans-serif", cursor: "pointer" }}>Ver sus eventos</button>
                            <div style={{ color: "#64748b", fontSize: 11.5, marginTop: 6 }}>Clic derecho: recorrido, controles e ícono.</div>
                        </div>
                    </Popup>
                </MarcadorGps>
            ))}

            {/* El menú y el panel van afuera del mapa (portal): adentro, Leaflet les roba los clics. */}
            {typeof document !== "undefined" && createPortal(
                <>
                    {/* El cartel de velocidad entra de abajo cuando el vehículo arranca. Va con transform
                        propio (translateX(-50%) para centrarlo) dentro de la animación, y se apaga
                        con «reducir movimiento». */}
                    <style>{`
                        .gps-vel { transform: translateX(-50%); animation: gps-vel-entra .32s cubic-bezier(.2,.9,.3,1.2) both; }
                        @keyframes gps-vel-entra { from { opacity: 0; transform: translateX(-50%) translateY(8px) scale(.85); } to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); } }
                        /* Los dibujos del globo. Cada uno se mueve sólo cuando lo que muestra está pasando:
                           un motor apagado no late, una posición vieja no emite. El movimiento es
                           el dato, no un adorno. */
                        .gd-onda { transform-origin: 8px 12px; animation: gd-onda 1.8s ease-out infinite; }
                        .gd-onda.b { animation-delay: .45s; }
                        @keyframes gd-onda { 0% { opacity: 0; } 25% { opacity: 1; } 100% { opacity: 0; } }
                        .gd-ping { transform-origin: 8px 14px; animation: gd-ping 1.8s ease-out infinite; }
                        @keyframes gd-ping { 0% { transform: scale(.3); opacity: .9; } 100% { transform: scale(1.5); opacity: 0; } }
                        .gd-late { transform-origin: 8px 8px; animation: gd-late 1.1s ease-in-out infinite; }
                        @keyframes gd-late { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.14); } }
                        .gd-aguja { transform-origin: 8px 11px; transition: transform .9s cubic-bezier(.2,.8,.2,1); }
                        .gd-tiembla { animation: gd-tiembla .5s ease-in-out infinite alternate; transform-origin: 8px 11px; }
                        @keyframes gd-tiembla { from { transform: rotate(-2.5deg); } to { transform: rotate(2.5deg); } }
                        .gd-carga { animation: gd-carga 1.4s ease-in-out infinite; }
                        @keyframes gd-carga { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
                        .gd-alerta { animation: gd-carga .8s ease-in-out infinite; }
                        /* El pin del evento elegido: cae a su lugar y late dos veces, para que el ojo lo encuentre
                           después del vuelo del mapa. */
                        .gps-pin { animation: gps-pin-cae .38s cubic-bezier(.2,.9,.3,1.25) both; transform-origin: 50% 100%; }
                        @keyframes gps-pin-cae { from { opacity: 0; transform: translateY(-14px) scale(.7); } to { opacity: 1; transform: translateY(0) scale(1); } }
                        .gps-pin-onda { animation: gps-pin-onda 1.6s ease-out 3; }
                        @keyframes gps-pin-onda { 0% { transform: scale(.4); opacity: .8; } 100% { transform: scale(2.6); opacity: 0; } }
                        @media (prefers-reduced-motion: reduce) { .gps-pin, .gps-pin-onda { animation: none; } .gps-pin-onda { opacity: 0; } }
                        @media (prefers-reduced-motion: reduce) { .gps-vel, .gd-onda, .gd-ping, .gd-late, .gd-tiembla, .gd-carga, .gd-alerta { animation: none; } .gd-aguja { transition: none; } }
                    `}</style>
                    {menu && delMenu && (
                        <div className="fixed z-[600] bg-popover border border-border rounded-lg shadow-xl py-1 text-xs min-w-[230px]" style={{ left: menu.x, top: menu.y }}
                            onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
                            <p className="px-3 pt-1.5 pb-1 text-[12.5px] font-bold truncate">{delMenu.nombre || `Rastreador ${delMenu.imei.slice(-6)}`}</p>
                            <p className="px-3 pb-1.5 text-[10.5px] text-muted-foreground border-b border-border">{delMenu.enLinea ? `En línea · reportó ${hace(delMenu.ultimoLatido)}` : "Sin reportar"}</p>

                            <Rotulo>Recorrido</Rotulo>
                            <div className="px-3 pb-1.5 flex flex-wrap gap-1">
                                {TRAMOS.map((t) => (
                                    <button key={t.clave} type="button" onClick={() => { elegirTramo(delMenu.imei, t.clave); setMenu(null); }}
                                        className={cn("h-6 px-2 rounded-full border text-[11px] font-semibold", queSeVe(delMenu.imei) === t.clave ? "bg-foreground text-background border-foreground" : "border-border hover:bg-accent")}>{t.rotulo}</button>
                                ))}
                            </div>
                            {queSeVe(delMenu.imei) && <Item icono={EyeOff} onClick={() => { cerrarRecorrido(); setMenu(null); }}>Ocultar el recorrido</Item>}
                            <Item icono={History} onClick={() => { abrirCajon(delMenu.imei); setMenu(null); }}>Ver sus eventos</Item>
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
                            <Item icono={Plus} onClick={() => { setCajon(null); setEvSel(null); setBorrador({ nombre: "", lat: delMenu.lat!, lon: delMenu.lon!, radio: 200, imeis: [], activa: true }); setPanelCercas(true); setMenu(null); }}>Nueva alrededor de acá</Item>
                            <Item icono={CircleDashed} onClick={() => { setCajon(null); setEvSel(null); setPanelCercas(true); setMenu(null); }}>Ver las geocercas{cercas.length ? ` (${cercas.length})` : ""}</Item>

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

                    {(ruta || estela) && deLaRuta && (
                        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[500] w-[min(640px,calc(100vw-32px))] rounded-[14px] border border-border bg-popover shadow-xl px-4 py-3">
                            <div className="flex items-center gap-2">
                                <Route size={15} className="text-muted-foreground shrink-0" />
                                <p className="text-[13px] font-bold truncate flex-1">{deLaRuta.nombre || deLaRuta.matricula || deLaRuta.imei.slice(-6)}</p>
                                <div className="flex gap-1">
                                    {TRAMOS.map((t) => (
                                        <button key={t.clave} type="button" onClick={() => elegirTramo(deLaRuta.imei, t.clave)}
                                            className={cn("h-6 px-2 rounded-full border text-[11px] font-semibold inline-flex items-center gap-1",
                                                queSeVe(deLaRuta.imei) === t.clave ? (t.clave === "vivo" ? "bg-emerald-500 text-white border-emerald-500" : "bg-foreground text-background border-foreground") : "border-border hover:bg-accent")}>
                                            {t.clave === "vivo" && <span className={cn("h-1.5 w-1.5 rounded-full", queSeVe(deLaRuta.imei) === "vivo" ? "bg-white animate-pulse" : "bg-emerald-500")} />}{t.rotulo}
                                        </button>
                                    ))}
                                </div>
                                <button type="button" onClick={cerrarRecorrido} aria-label="Cerrar el recorrido" className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:bg-accent"><X size={14} /></button>
                            </div>
                            {estela ? (
                                !estela.puntos ? (
                                    <p className="mt-2 text-[12px] text-muted-foreground inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Trayendo los últimos minutos…</p>
                                ) : (
                                    <>
                                        <dl className="mt-2 grid grid-cols-4 gap-3 text-[12.5px]">
                                            <Cifra k="Ahora" v={`${deLaRuta.velocidad || 0} km/h`} />
                                            <Cifra k="En 10 min" v={`${cuentaEstela.km.toFixed(1).replace(".", ",")} km`} />
                                            <Cifra k="Máxima" v={`${cuentaEstela.velMax} km/h`} />
                                            <Cifra k="Reportó" v={hace(deLaRuta.cuando)} />
                                        </dl>
                                        {estela.vivo && suelta && (
                                            <button type="button" onClick={() => { setSuelta(false); mapa.panTo([deLaRuta.lat!, deLaRuta.lon!]); }}
                                                className="mt-2 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-border text-[11.5px] font-semibold hover:bg-accent"><LocateFixed size={13} /> Volver a seguirlo</button>
                                        )}
                                        {ptsEstela.length < 2 && <p className="mt-2 text-[12px] text-muted-foreground">Sin posiciones con buena señal en los últimos 10 minutos{estela.vivo ? ": va a aparecer apenas reporte." : "."}</p>}
                                    </>
                                )
                            ) : !ruta ? null : !ruta.datos ? (
                                <p className="mt-2 text-[12px] text-muted-foreground inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Trayendo el recorrido…</p>
                            ) : viajes.length === 0 ? (
                                <p className="mt-2 text-[12px] text-muted-foreground">
                                    {ruta.datos.resumen.puntos < 2 ? "No hay posiciones con buena señal en ese tramo." : "No hizo ningún viaje en ese tramo: estuvo en el mismo lugar."}
                                </p>
                            ) : (
                                <dl className="mt-2 grid grid-cols-4 gap-3 text-[12.5px]">
                                    <Cifra k="Recorrió" v={`${ruta.datos.resumen.km.toFixed(1).replace(".", ",")} km`} />
                                    <Cifra k="En movimiento" v={ruta.datos.resumen.enMovimientoMin >= 60 ? `${Math.floor(ruta.datos.resumen.enMovimientoMin / 60)} h ${ruta.datos.resumen.enMovimientoMin % 60} min` : `${ruta.datos.resumen.enMovimientoMin} min`} />
                                    <Cifra k="Velocidad máxima" v={`${ruta.datos.resumen.velMax} km/h`} />
                                    <Cifra k="Desde" v={fechaHora(ruta.datos.resumen.desde)} />
                                </dl>
                            )}
                            {!estela && viajes.length > 0 && (
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

                    {cajon && (
                        <CajonEventosGps key={cajon} imei={cajon} rastreador={lista.find((r) => r.imei === cajon)} elegido={evSel?.e.id || null}
                            alElegir={elegirEvento} alCerrar={() => { setCajon(null); setEvSel(null); }} refresco={refrescoCajon} />
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
                                            <span className="min-w-0 flex-1">
                                                <span className="block text-[12.5px] font-semibold truncate">{c.nombre}</span>
                                                {c.activa && adentroDe(c).length > 0 && <span className="block text-[10.5px] tono-bien truncate">{adentroDe(c).map((r) => r.nombre || r.matricula || r.imei.slice(-6)).join(", ")} adentro</span>}
                                            </span>
                                            <span className="text-[11px] text-muted-foreground tabular-nums">{c.radio >= 1000 ? `${(c.radio / 1000).toFixed(1).replace(".", ",")} km` : `${c.radio} m`}</span>
                                        </button>
                                    ))}
                                    <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => setColocando(true)} disabled={colocando}>
                                        <Plus size={13} /> {colocando ? "Tocá el mapa donde va el centro…" : "Nueva: tocar el mapa"}
                                    </Button>
                                    <p className="px-2 pt-2 text-[11px] text-muted-foreground leading-snug">Un cruce se ve acá en el momento: la geocerca se enciende y sale un cartel. Para que además llegue por Telegram, WhatsApp o correo, armá una regla de GPS con «Entró» o «Salió de una geocerca» en Notificaciones.</p>
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

function Renglon({ icono, k, v, aviso }: { icono?: React.ReactNode; k: string; v: string; aviso?: string }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, minHeight: 22 }}>
            <span style={{ color: "#64748b", display: "inline-flex", alignItems: "center", gap: 6 }}>{icono}{k}</span>
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

const COLOR_TONO: Record<string, string> = { mal: ROJO, aviso: AMBAR, bien: VERDE, info: CELESTE, quieto: GRIS };
const limpio = (t: string) => t.replace(/[<>&]/g, "");

/** El pin de un evento: del color de su tono, con qué fue y a qué hora encima. */
function pinDeEvento(e: EventoGps): L.DivIcon {
    const c = COLOR_TONO[fichaDeEventoGps(e.tipo).tono] || GRIS;
    const { titulo } = tituloDeEventoGps(e);
    return L.divIcon({
        className: "bg-transparent border-0", iconSize: [260, 74], iconAnchor: [130, 70],
        html: `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:none">
            <div class="gps-pin" style="display:flex;flex-direction:column;align-items:center">
                <div style="max-width:250px;padding:3px 10px;border-radius:10px;background:#0a0e14;color:#fff;border:2px solid ${c};box-shadow:0 3px 12px rgba(0,0,0,.5);font:700 12px/16px Outfit,system-ui,sans-serif;text-align:center">
                    <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${limpio(titulo)}</div>
                    <div style="font-weight:600;font-size:10.5px;opacity:.75;font-variant-numeric:tabular-nums">${limpio(fechaCorta(e.cuando))} · ${limpio(horaSeg(e.cuando))}</div>
                </div>
                <div style="width:2px;height:12px;background:${c}"></div>
            </div>
            <div style="position:relative;width:14px;height:14px">
                <div class="gps-pin-onda" style="position:absolute;inset:0;border-radius:50%;border:2px solid ${c}"></div>
                <div style="position:absolute;inset:0;border-radius:50%;background:${c};border:2.5px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.5)"></div>
            </div>
        </div>`,
    });
}

/** Un salto más largo que esto no se desliza: es un hueco sin reportes, no un movimiento. */
const SALTO_MAX_M = 1500;
/** Y un silencio más largo que esto tampoco: lo que pasó en el medio no se sabe. */
const HUECO_MS = 60_000;
/** Cuánto tarda el número de la velocidad en llegar al valor nuevo. */
const CUENTA_MS = 900;

/**
 * El marcador de un rastreador, que ANDA por donde anduvo el vehículo en vez de saltar.
 *
 * Pedido de Nico (21/11): «más continuo, similar a PedidosYa», y al ver la primera versión:
 * «parecen movimientos por tramos, de tiros, y no fluido».
 *
 * La primera versión deslizaba el marcador hasta cada posición nueva en diez segundos fijos. Eso
 * se ve a tirones por una razón precisa: las posiciones NO llegan cada diez segundos exactos. Un
 * tramo que el auto hizo en cuatro segundos se dibujaba en diez (lento) y uno de quince, en diez
 * (rápido, y después quieto cinco esperando). La velocidad del dibujo cambiaba en cada posición.
 *
 * Ahora se hace lo que hacen las aplicaciones de reparto: **se reproduce el camino con un retraso
 * fijo**. Cada posición trae su hora; el marcador se dibuja donde el vehículo estaba hace
 * RETRASO_MS, interpolando entre las dos posiciones que rodean ese instante. Cada tramo se
 * recorre en lo que de verdad tardó, así que el dibujo va a la velocidad real y no frena en cada
 * punto. El costo es que lo que se ve pasó hace trece segundos; los datos del globo son los de
 * ahora.
 *
 * Cuidados:
 *  · Se mueve el marcador de Leaflet DIRECTAMENTE, no por estado de React: sesenta renders por
 *    segundo de toda la capa para mover un punto es tirar la pantalla abajo.
 *  · El reloj del equipo y el de esta máquina no tienen por qué coincidir: se usa la demora más
 *    chica que se vio entre «hora del equipo» y «hora en que llegó», no la hora a secas.
 *  · Un salto de más de 1,5 km o un silencio de más de un minuto no se reproducen: se salta.
 *  · Con «reducir movimiento» activado en el sistema, se salta siempre.
 */
function MarcadorGps({ r, seguir, alMover, eventHandlers, children }: {
    r: Rastreador; seguir: boolean;
    /** Dónde se lo está dibujando y a qué hora del equipo corresponde (Infinity = llegó al final). */
    alMover?: (lat: number, lon: number, t: number) => void;
    eventHandlers: L.LeafletEventHandlerFnMap; children: React.ReactNode;
}) {
    const mapa = useMap();
    const ref = useRef<L.Marker>(null);
    /* La posición inicial queda fija para React: después la mueve la animación. Si se le pasara la
       nueva, react-leaflet la pondría de un salto y no habría nada que animar. */
    const [inicial] = useState<[number, number]>([r.lat!, r.lon!]);
    const cuadro = useRef<number | null>(null);
    const sigue = useRef(seguir); sigue.current = seguir;
    const avisa = useRef(alMover); avisa.current = alMover;
    /** Las últimas posiciones con su hora (del equipo, en ms): el camino a reproducir. */
    const cola = useRef<{ t: number; lat: number; lon: number }[]>([]);
    /** La demora más chica vista entre la hora del equipo y la llegada: pasa de un reloj al otro. */
    const desfase = useRef<number | null>(null);

    const andar = useCallback(() => {
        if (cuadro.current) return;
        const paso = () => {
            const mk = ref.current, c = cola.current;
            if (!mk || !c.length) { cuadro.current = null; return; }
            const tp = Date.now() - (desfase.current || 0) - RETRASO_MS;
            const { lat, lon, llego } = posicionEn(c, tp)!;      // la cuenta está en lib/gps-reproducir, con sus pruebas
            mk.setLatLng([lat, lon]);
            avisa.current?.(lat, lon, llego ? Infinity : tp);
            /* En vivo la cámara va con él, cuadro a cuadro: si se moviera de a saltos, el auto
               se deslizaría y el mapa pegaría un tirón cada diez segundos. */
            if (sigue.current) mapa.panTo([lat, lon], { animate: false });
            /* Llegó a la última posición conocida: se queda ahí, sin gastar cuadros, hasta la próxima. */
            cuadro.current = llego ? null : requestAnimationFrame(paso);
        };
        cuadro.current = requestAnimationFrame(paso);
    }, [mapa]);

    useEffect(() => {
        const mk = ref.current; if (!mk) return;
        const t = r.cuando ? Date.parse(r.cuando) : Date.now();
        const c = cola.current, ult = c[c.length - 1];
        if (ult && t <= ult.t) return;                      // la misma posición, traída otra vez por el refresco
        const llegada = Date.now() - t;
        if (desfase.current === null || llegada < desfase.current) desfase.current = llegada;
        const quieto = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        const lejos = ult ? L.latLng(ult.lat, ult.lon).distanceTo([r.lat!, r.lon!]) > SALTO_MAX_M : false;
        if (!ult || quieto || lejos || t - ult.t > HUECO_MS) {
            /* Sin camino que reproducir (la primera, un hueco, un salto): se pone ahí y listo. */
            cola.current = [{ t, lat: r.lat!, lon: r.lon! }];
            if (cuadro.current) { cancelAnimationFrame(cuadro.current); cuadro.current = null; }
            mk.setLatLng([r.lat!, r.lon!]);
            avisa.current?.(r.lat!, r.lon!, Infinity);
            if (sigue.current) mapa.panTo([r.lat!, r.lon!], { animate: !quieto });
            return;
        }
        c.push({ t, lat: r.lat!, lon: r.lon! });
        if (c.length > 16) c.shift();
        andar();
    }, [r.lat, r.lon, r.cuando, mapa, andar]);
    useEffect(() => () => { if (cuadro.current) cancelAnimationFrame(cuadro.current); }, []);

    /* Al empezar a seguirlo, la cámara va a donde está AHORA (no espera a la próxima posición). */
    useEffect(() => { if (seguir && ref.current) mapa.setView(ref.current.getLatLng(), Math.max(mapa.getZoom(), 16)); }, [seguir, mapa]);

    /* El ícono sólo se rehace cuando cambia algo que se ve: si se rehiciera en cada refresco, el
       dibujo parpadearía en medio del deslizamiento. */
    const tono = tonoDe(r), andando = (r.velocidad || 0) > 3;
    /* Ni el rumbo ni la velocidad rehacen el ícono: cambian con cada posición, y rehacerlo es
       cambiar el elemento entero — el cartel de la velocidad volvería a «entrar» cada diez
       segundos. Los dos se actualizan sobre el elemento que ya está (más abajo). */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `icono(r)` sólo depende de lo listado
    const ic = useMemo(() => icono(r), [tono, andando, r.icono, r.nombre, r.matricula, r.cortado, r.sinReporteDesde]);

    /* La flecha gira hasta el rumbo nuevo por el camino corto: de 350° a 10° son 20° hacia
       adelante, no 340° hacia atrás. Por eso se acumula el ángulo en vez de asignarlo. */
    const angulo = useRef(r.rumbo || 0);
    const iconoVisto = useRef<L.DivIcon | null>(null);
    useEffect(() => {
        const el = ref.current?.getElement()?.querySelector<HTMLElement>(".gps-rumbo");
        const nuevo = r.rumbo || 0;
        angulo.current += ((nuevo - (((angulo.current % 360) + 360) % 360) + 540) % 360) - 180;
        if (!el) return;
        /* Un ícono recién hecho nace apuntando a `rumbo` (entre 0 y 359) y el acumulado puede ser
           370: animar de uno al otro sería una vuelta entera de la flecha. La primera vez se
           pone sin transición. */
        if (iconoVisto.current !== ic) {
            iconoVisto.current = ic;
            el.style.transition = "none";
            el.style.transform = `rotate(${angulo.current}deg)`;
            requestAnimationFrame(() => { el.style.transition = "transform .6s linear"; });
            return;
        }
        el.style.transform = `rotate(${angulo.current}deg)`;
    }, [r.rumbo, ic]);

    /* El número de la velocidad sube o baja hasta el valor nuevo en vez de cambiar de golpe: de 42
       a 67 pasando por los del medio, que es lo que hace un velocímetro. Se escribe en el DOM del
       marcador directamente, por lo mismo que la posición. Depende también de `ic`: cuando el
       ícono se rehace, el elemento es otro y hay que volver a ponerle el número. */
    const mostrada = useRef(r.velocidad || 0);
    const cuadroVel = useRef<number | null>(null);
    useEffect(() => {
        const el = ref.current?.getElement()?.querySelector<HTMLElement>(".gps-vel-n");
        const a = r.velocidad || 0;
        if (cuadroVel.current) cancelAnimationFrame(cuadroVel.current);
        if (!el) { mostrada.current = a; return; }
        const de = mostrada.current;
        const quieto = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (de === a || quieto) { el.textContent = String(a); mostrada.current = a; return; }
        const t0 = performance.now();
        const paso = (t: number) => {
            const k = Math.min(1, (t - t0) / CUENTA_MS);
            /* Frena al llegar (ease-out): arranca rápido y se asienta en el valor, sin rebote. */
            const v = Math.round(de + (a - de) * (1 - Math.pow(1 - k, 3)));
            el.textContent = String(v); mostrada.current = v;
            if (k < 1) cuadroVel.current = requestAnimationFrame(paso);
        };
        cuadroVel.current = requestAnimationFrame(paso);
        return () => { if (cuadroVel.current) cancelAnimationFrame(cuadroVel.current); };
    }, [r.velocidad, ic]);

    return <Marker ref={ref} position={inicial} icon={ic} zIndexOffset={1500} eventHandlers={eventHandlers}>{children}</Marker>;
}

/**
 * Los dibujos de cada renglón del globo (pedido de Nico, 21/11: «iconografía a cada campo,
 * animados»). Dibujos propios de 16×16, hechos acá porque cada uno tiene que moverse según el
 * dato y un ícono de biblioteca no sabe cuánto es 73 km/h.
 *
 * La regla: **se mueve lo que está pasando**. Las ondas salen si está en línea; el punto late en
 * el mapa si la posición es de recién; el motor late si está encendido; la aguja marca la
 * velocidad de verdad y tiembla si anda; la batería se llena según el voltaje y parpadea su rayo
 * si el alternador está cargando; el candado titila en rojo si el relé está accionado. Quieto y
 * gris quiere decir exactamente eso.
 */
function Dibujo({ que, vivo, valor, tono }: { que: "estado" | "posicion" | "motor" | "velocidad" | "bateria" | "rele"; vivo: boolean; valor?: number; tono?: string }) {
    const gris = "#94a3b8";
    const p = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, style: { flexShrink: 0 } };
    switch (que) {
        case "estado": {
            const c = vivo ? VERDE : gris;
            return (
                <svg {...p} stroke={c}>
                    <circle cx="8" cy="12" r="1.4" fill={c} stroke="none" />
                    <path d="M5 9.2a4.2 4.2 0 0 1 6 0" className={vivo ? "gd-onda" : undefined} opacity={vivo ? undefined : 0.5} />
                    <path d="M2.6 6.6a7.6 7.6 0 0 1 10.8 0" className={vivo ? "gd-onda b" : undefined} opacity={vivo ? undefined : 0.3} />
                </svg>
            );
        }
        case "posicion": {
            const c = tono || (vivo ? VERDE : gris);
            return (
                <svg {...p} stroke={c}>
                    {vivo && <ellipse cx="8" cy="14" rx="4" ry="1.4" className="gd-ping" stroke={c} strokeWidth="1" />}
                    <path d="M8 14s4.2-3.9 4.2-7.3a4.2 4.2 0 0 0-8.4 0C3.8 10.1 8 14 8 14Z" fill="#fff" />
                    <circle cx="8" cy="6.6" r="1.5" fill={c} stroke="none" />
                </svg>
            );
        }
        case "motor": {
            const c = vivo ? VERDE : gris;
            return (
                <svg {...p} stroke={c}>
                    <g className={vivo ? "gd-late" : undefined}>
                        <path d="M8 2.2v5" />
                        <path d="M11.4 4.3a5 5 0 1 1-6.8 0" />
                    </g>
                </svg>
            );
        }
        case "velocidad": {
            /* 0 km/h apunta a la izquierda, 140 a la derecha: la aguja dice cuánto, no sólo que hay algo. */
            const grados = -90 + Math.min(1, Math.max(0, (valor || 0) / 140)) * 180;
            const c = vivo ? ((valor || 0) > 110 ? AMBAR : VERDE) : gris;
            return (
                <svg {...p} stroke={c}>
                    <path d="M2.4 11a5.6 5.6 0 0 1 11.2 0" />
                    <g className={vivo ? "gd-tiembla" : undefined}>
                        <g className="gd-aguja" style={{ transform: `rotate(${grados}deg)` }}>
                            <path d="M8 11V6.4" strokeWidth="1.8" />
                        </g>
                    </g>
                    <circle cx="8" cy="11" r="1.2" fill={c} stroke="none" />
                </svg>
            );
        }
        case "bateria": {
            /* De 11,5 V (vacía) a 12,8 V (llena) en reposo; arriba de 13,2 está cargando el alternador. */
            const nivel = valor === undefined ? 0 : Math.min(1, Math.max(0.08, (valor - 11.5) / 1.3));
            const c = valor === undefined ? gris : valor < 11.8 ? AMBAR : VERDE;
            return (
                <svg {...p} stroke={c}>
                    <rect x="1.6" y="4.6" width="11.2" height="6.8" rx="1.6" />
                    <path d="M14.4 7v2" />
                    <rect x="3" y="6" width={8.4 * nivel} height="4" rx="0.8" fill={c} stroke="none" opacity={vivo ? 0.45 : 0.9} />
                    {vivo && <path d="M8.6 5.4 6.6 8.2h2.2L7 10.8" stroke="#fff" strokeWidth="1.3" className="gd-carga" />}
                </svg>
            );
        }
        case "rele": {
            const c = vivo ? ROJO : gris;
            return (
                <svg {...p} stroke={c} className={vivo ? "gd-alerta" : undefined}>
                    <rect x="3.4" y="7.4" width="9.2" height="6" rx="1.4" fill={vivo ? c : "none"} fillOpacity={vivo ? 0.18 : 0} />
                    {/* Accionado: el candado cerrado. En reposo: abierto. */}
                    <path d={vivo ? "M5.4 7.4V5.6a2.6 2.6 0 0 1 5.2 0v1.8" : "M5.4 7.4V5.6a2.6 2.6 0 0 1 5-1"} />
                </svg>
            );
        }
    }
}
