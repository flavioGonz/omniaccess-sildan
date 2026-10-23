"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTiempoReal } from "@/lib/tiempo-real";
import { usePublicarAvisos, useSilencioAvisos, type Aviso } from "@/lib/avisos-pantalla";
import { FichaEventoCentral } from "@/components/centrales/FichaEventoCentral";
import { ESCALADO_DEFECTO, type Escalado, type EventoCentral } from "@/lib/centrales/tratamiento-tipos";

/**
 * Los eventos de las centrales de alarma, en TODO el panel (22/10, Nico: «similar a Intrusión; un
 * evento de intrusión de una alarma es más importante que el resto, necesita una intervención humana»).
 *
 * Como la intrusión de las cámaras, se monta en el layout del panel:
 *  · un evento de prioridad alta (hasta `ventanaHasta`, P1 y P2 de fábrica) que nadie más tiene ABRE
 *    SU FICHA con sonido, en cualquier pantalla. Cerrarla no lo resuelve: queda abajo, en la pila de
 *    avisos, como crítico, hasta que alguien lo trate. Si se escala, vuelve a abrirse;
 *  · el que tiene otro compañero queda en la pila con su nombre (no se le impone a los demás);
 *  · los de prioridad media (hasta `avisoHasta`) entran a la pila sin abrir ventana;
 *  · el resto sólo queda en el registro (Gestión de alarmas › Centrales).
 * Cualquier pantalla puede abrir la ficha de un evento con abrirEventoCentral(id).
 */

const RELECTURA_MS = 15_000;
const SONIDO_MS = 6_000;
/** Si lo tengo yo, el pitido se espacia: ya sé que está, pero no se olvida. */
const SONIDO_MIO_MS = 15_000;

function pitido(urgente: boolean) {
    try {
        const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext; if (!Ctx) return;
        const ctx = new Ctx(); const tonos = urgente ? [740, 988, 740, 988, 740] : [740];
        tonos.forEach((f, i) => { const o = ctx.createOscillator(); const g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.type = "sawtooth"; o.frequency.value = f; const t = ctx.currentTime + i * 0.18; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16); o.start(t); o.stop(t + 0.17); });
    } catch { /* sin audio */ }
}

export default function AlertaCentralGlobal() {
    const [eventos, setEventos] = useState<EventoCentral[]>([]);
    const [esc, setEsc] = useState<Escalado>(ESCALADO_DEFECTO);
    const releer = useCallback(() => {
        fetch("/api/centrales/eventos", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => {
            if (!j?.ok) return;
            setEventos(j.eventos || []); if (j.escalado) setEsc(j.escalado);
        }).catch(() => { });
    }, []);
    useEffect(() => { releer(); const iv = setInterval(releer, RELECTURA_MS); return () => clearInterval(iv); }, [releer]);
    const [pulso, setPulso] = useState(0);
    useEffect(() => { if (!pulso) return; const t = setTimeout(releer, 600); return () => clearTimeout(t); }, [pulso, releer]);
    const latir = useCallback(() => setPulso((n) => n + 1), []);
    useTiempoReal("general_detection", useCallback((d: any) => { if (d?.type === "CENTRAL") latir(); }, [latir]));
    useTiempoReal("alarma_gestion", latir);
    useTiempoReal("central_tratado", latir);

    /** Abierta ahora. `null` = ninguna. */
    const [abierto, setAbierto] = useState<string | null>(null);
    /** Las que cerré sin tratar: quedan en la pila y no vuelven a abrirse solas (salvo que se escalen). */
    const [postergadas, setPostergadas] = useState<Set<string>>(() => new Set());
    useTiempoReal("central_escalado", useCallback((d: any) => {
        if (d?.id) setPostergadas((p) => { const n = new Set(p); n.delete(d.id); return n; });
        latir();
    }, [latir]));
    useEffect(() => {
        const abrir = (e: Event) => { const id = (e as CustomEvent).detail?.id; if (id) setAbierto(id); };
        window.addEventListener("omni:evento-central", abrir);
        return () => window.removeEventListener("omni:evento-central", abrir);
    }, []);

    const deOtro = (e: EventoCentral) => !!e.operador.nombre && !e.operador.soyYo;
    const urgentes = useMemo(() => eventos.filter((e) => e.prioridad <= esc.ventanaHasta), [eventos, esc]);
    // La que salta: la más urgente que nadie más tiene y que no cerré.
    const candidata = urgentes.find((e) => !deOtro(e) && !postergadas.has(e.id)) || null;
    useEffect(() => { if (!abierto && candidata) setAbierto(candidata.id); }, [abierto, candidata?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const [silencio] = useSilencioAvisos();
    const piden = urgentes.filter((e) => !deOtro(e));
    const soloMias = piden.length > 0 && piden.every((e) => e.operador.soyYo);
    const cuantas = useRef(0);
    useEffect(() => {
        if (!piden.length || silencio) { cuantas.current = piden.length; return; }
        if (piden.length > cuantas.current) pitido(true);
        cuantas.current = piden.length;
        const iv = setInterval(() => pitido(!soloMias), soloMias ? SONIDO_MIO_MS : SONIDO_MS);
        return () => clearInterval(iv);
    }, [piden.length, soloMias, silencio]);

    const cerrar = () => { if (abierto) setPostergadas((p) => new Set(p).add(abierto)); setAbierto(null); };

    // La pila de avisos: las que no están abiertas, hasta la prioridad de aviso.
    const avisos: Aviso[] = eventos.filter((e) => e.prioridad <= esc.avisoHasta && e.id !== abierto).map((e) => ({
        id: `central:${e.id}`, tipo: "central", nivel: e.prioridad <= esc.ventanaHasta ? "critico" : "alerta", ts: e.ts, sonidoPropio: true,
        rotulo: `P${e.prioridad} · Central de alarma${e.escalado ? " · escalado" : ""}`, titulo: e.titulo,
        detalle: [e.central.nombre, e.area].filter(Boolean).join(" · "),
        operador: e.operador.soyYo ? "Lo atendés vos" : e.operador.nombre ? `Lo tiene ${e.operador.nombre}` : "Nadie lo tomó",
        acciones: [{ clave: "ver", etiqueta: e.operador.nombre && !e.operador.soyYo ? "Ver" : "Tratar", icono: "ver", principal: true, ayuda: "Abrir la ficha del evento", correr: () => setAbierto(e.id) }],
    }));
    usePublicarAvisos("centrales", avisos);

    return <FichaEventoCentral id={abierto} abierta={!!abierto} alCerrar={cerrar} />;
}
