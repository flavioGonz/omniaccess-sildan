"use client";

import { useFuncion } from "@/lib/funciones-cliente";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTiempoReal } from "@/lib/tiempo-real";
import { getImagePath } from "@/lib/image-path";
import { ETIQUETA_AVISO, type TipoAviso as TipoAvisoGuardia } from "@/lib/visitas/presentacion";
import { usePublicarAvisos, type Aviso, type AccionAviso, type TipoAviso } from "@/lib/avisos-pantalla";
import { getOperadores, tomarGestion, pasarGestion, type OperadorVista } from "@/app/actions/detections";
import { FichaDeEvento } from "@/components/eventos/FichaDeEvento";

/**
 * Lo que salta por LPR, patrones y OmniVision en la pila de avisos (lib/avisos-pantalla), en
 * TODA la app (20/10). Antes la lista negra y el merodeo saltaban sólo en el Monitor LPR, y los
 * avisos de patrones y de OmniVision no saltaban en ningún lado: había que entrar a Gestión de
 * alarmas a buscarlos.
 *
 *   - Lista negra (crítico): no se cierra sin decidir real o falsa.
 *   - En búsqueda y merodeo (alerta, ámbar).
 *   - Patrones (alerta, azul) y OmniVision (alerta, violeta): los avisos de la guardia que
 *     Gestión de alarmas ya lista. «Sin registrar» no: son decenas por día y no son alarmas.
 *
 * Decidir acá es lo mismo que decidir en Gestión de alarmas (POST /api/alarmas, con la misma
 * clave: l:<evento> o a:<aviso>), así que lo marcado en un lado desaparece del otro. Lo repetido
 * (misma matrícula o cámara, mismo tipo, en AGRUPAR_MS) va en una sola barra con «×N», y la
 * decisión vale para todas las lecturas del grupo.
 *
 * Son avisos en vivo: lo que pasó antes de abrir la pantalla está en Gestión de alarmas.
 */

const AGRUPAR_MS = 5 * 60_000;
/** Lo que no se decide queda como mucho este tiempo en pantalla (alerta). Lo crítico, hasta decidir. */
const VIDA_ALERTA_MS = 30 * 60_000;
const AVISOS_QUE_NO_SALTAN = new Set(["SIN_REGISTRAR"]);
const SENTIDO: Record<string, string> = { ENTRY: "entrada", EXIT: "salida" };
/** Cada cuánto se vuelve a pedir la lista de proveedores con pase libre. */
const PASE_LIBRE_REFRESCO_MS = 5 * 60_000;
const limpiar = (p: unknown) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

type Item = {
    id: string; tipo: TipoAviso; nivel: "critico" | "alerta"; ts: string; foto: string | null;
    rotulo: string; titulo: string; detalle: string | null; grupo: string;
    /** Las claves de gestión del grupo (l:<evento> | a:<aviso>); la primera es la más nueva. */
    claves: string[];
    /** El evento LPR para «Ver evento» (la ficha del Monitor LPR). */
    eventoId: string | null;
    plate: string | null; deviceId: string | null;
};

export function AvisosLpr({ soloLectura = false }: {
    /** La pared: sólo se ve; no hay sesión para decidir ni para abrir la ficha. */
    soloLectura?: boolean;
}) {
    const router = useRouter();
    const [items, setItems] = useState<Item[]>([]);
    const [ficha, setFicha] = useState<string | null>(null);
    const [ops, setOps] = useState<Record<string, OperadorVista>>({});
    const [pulso, setPulso] = useState(0);
    // Sin «En búsqueda» (función de LPR, apagada en San Nicolás) no salta ese aviso.
    const busquedaOn = useFuncion("LPR_BUSQUEDA");

    /*
     * Proveedores con pase libre (20/10, Nico: «no deben notificar este nuevo sistema de noti»): sus
     * matrículas no saltan acá salvo por lista negra. Se pide al montar y cada PASE_LIBRE_REFRESCO_MS
     * (alguien pudo darle pase libre a otro proveedor). Ver api/avisos/pase-libre.
     */
    const paseLibre = useRef<Set<string>>(new Set());
    useEffect(() => {
        let vivo = true;
        const pedir = () => fetch("/api/avisos/pase-libre", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
            .then((j) => { if (vivo && Array.isArray(j?.matriculas)) paseLibre.current = new Set(j.matriculas); }).catch(() => { });
        pedir();
        const t = setInterval(pedir, PASE_LIBRE_REFRESCO_MS);
        return () => { vivo = false; clearInterval(t); };
    }, []);

    const sumar = useCallback((n: Item) => setItems((prev) => {
        if (n.tipo !== "lista-negra" && n.plate && paseLibre.current.has(limpiar(n.plate))) return prev;
        const ahora = Date.now();
        const vivos = prev.filter((x) => x.nivel === "critico" || ahora - new Date(x.ts).getTime() < VIDA_ALERTA_MS);
        const i = vivos.findIndex((x) => x.grupo === n.grupo && ahora - new Date(x.ts).getTime() < AGRUPAR_MS);
        // El id de la barra lleva el tipo: una misma lectura puede ser lista negra Y merodeo.
        if (i < 0) return [{ ...n, id: `${n.grupo}|${n.claves[0]}` }, ...vivos].slice(0, 40);
        const g = vivos[i];
        if (g.claves.includes(n.claves[0])) return vivos;
        const unido: Item = { ...g, ts: n.ts, foto: n.foto || g.foto, detalle: n.detalle || g.detalle, eventoId: n.eventoId || g.eventoId, claves: [...n.claves, ...g.claves] };
        return [unido, ...vivos.filter((_, j) => j !== i)];
    }), []);
    const quitarClaves = useCallback((claves: string[]) => setItems((prev) => prev
        .map((x) => ({ ...x, claves: x.claves.filter((c) => !claves.includes(c)) }))
        .filter((x) => x.claves.length > 0)), []);

    // ── Lecturas: lista negra (crítico) y en búsqueda (alerta) ──
    useTiempoReal("access_event", (ev: any) => {
        if (!ev?.id || ev.accessType !== "PLATE") return;
        const cat = String(ev.watch?.category || "").toUpperCase();
        const negra = cat === "BLACKLISTED" || String(ev.user?.role || "").toUpperCase() === "BLACKLISTED";
        const busqueda = !negra && cat === "SEARCH" && busquedaOn !== false;
        if (!negra && !busqueda) return;
        const plate = limpiar(ev.plateDetected) || null;
        const camara = ev.device?.name || null;
        sumar({
            id: `l:${ev.id}`, tipo: negra ? "lista-negra" : "busqueda", nivel: negra ? "critico" : "alerta",
            ts: ev.timestamp ? new Date(ev.timestamp).toISOString() : new Date().toISOString(),
            foto: getImagePath(ev.snapshotPath || ev.imagePath) || null,
            rotulo: negra ? "Lista negra" : "En búsqueda", titulo: plate || "Sin lectura",
            detalle: [camara, SENTIDO[ev.direction], ev.watch?.motivo || ev.watch?.label].filter(Boolean).join(" · ") || null,
            grupo: `${negra ? "negra" : "busqueda"}:${plate || camara}`, claves: [`l:${ev.id}`], eventoId: ev.id, plate, deviceId: ev.device?.id || ev.deviceId || null,
        });
    });

    // ── Merodeo (alerta): la misma matrícula pasando y pasando ──
    useTiempoReal("merodeo_alert", (m: any) => {
        const plate = limpiar(m?.plate) || null;
        const ts = m?.timestamp || new Date().toISOString();
        sumar({
            id: m?.accessEventId ? `l:${m.accessEventId}` : `mer:${plate}:${ts}`, tipo: "merodeo", nivel: "alerta", ts,
            foto: getImagePath(m?.snapshotPath) || null, rotulo: "Merodeo", titulo: plate || "Sin lectura",
            detalle: [`${m?.count ?? "?"} pasadas en ${m?.windowMin ?? "?"} min`, m?.deviceName].filter(Boolean).join(" · "),
            grupo: `merodeo:${plate}`, claves: m?.accessEventId ? [`l:${m.accessEventId}`] : [`mer:${plate}:${ts}`],
            eventoId: m?.accessEventId || null, plate, deviceId: null,
        });
    });

    // ── Avisos de la guardia: patrones y OmniVision ──
    useTiempoReal("aviso_guardia", (x: any) => {
        const a = x?.aviso;
        if (!a?.id) return; // «actualizado» (vision-reglas) trae sólo el id: el texto nuevo se ve en Gestión de alarmas.
        if (x.accion === "atendido") { quitarClaves([`a:${a.id}`]); return; }
        if (AVISOS_QUE_NO_SALTAN.has(a.tipo)) return;
        if (x.accion !== "nuevo") return;
        const vision = String(a.tipo).startsWith("VISION_");
        const et = ETIQUETA_AVISO[a.tipo as TipoAvisoGuardia];
        const f = a.datos?.foto;
        sumar({
            id: `a:${a.id}`, tipo: vision ? "vision" : "patron", nivel: "alerta", ts: a.creado || new Date().toISOString(),
            foto: typeof f === "string" && f ? (f.startsWith("/") ? f : `/api/vision/imagen/${f}`) : null,
            rotulo: et?.titulo || (vision ? "OmniVision" : "Patrón"), titulo: a.plate || a.camara || (vision ? "OmniVision" : "Aviso"),
            detalle: [a.plate ? a.camara : null, a.motivo].filter(Boolean).join(" · ") || null,
            grupo: `${a.tipo}:${a.plate || a.camara || a.id}`, claves: [`a:${a.id}`], eventoId: a.accessEventId || null, plate: a.plate || null, deviceId: null,
        });
    });

    // Decidida en otra pantalla (Gestión de alarmas, otra guardia): se va de acá también.
    useTiempoReal("alarma_atendida", (x: any) => { if (x?.id) quitarClaves([String(x.id)]); });
    useTiempoReal("alarma_gestion", () => setPulso((n) => n + 1));

    // Quién atiende cada una (Tomar / Pasar, como la intrusión).
    const claves = useMemo(() => items.map((x) => x.claves[0]).filter((c) => /^[la]:/.test(c)).sort().join(","), [items]);
    useEffect(() => {
        if (soloLectura || !claves) { setOps({}); return; }
        getOperadores(claves.split(",")).then(setOps).catch(() => { });
    }, [claves, pulso, soloLectura]);

    const decidir = useCallback(async (it: Item, resultado: "real" | "falsa") => {
        const gestionables = it.claves.filter((c) => /^[la]:/.test(c));
        const r = await Promise.all(gestionables.map((id) => fetch("/api/alarmas", {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, atender: true, resultado }),
        }).then((x) => x.ok).catch(() => false)));
        // Lo que no se pudo guardar queda a la vista: mejor una barra de más que una decisión perdida.
        quitarClaves([...gestionables.filter((_, i) => r[i]), ...it.claves.filter((c) => !/^[la]:/.test(c))]);
    }, [quitarClaves]);

    const avisos: Aviso[] = useMemo(() => items.map((it) => {
        const clave = it.claves[0];
        const gestionable = /^[la]:/.test(clave);
        const o = ops[clave];
        const acciones: AccionAviso[] = [];
        if (!soloLectura) {
            if (it.eventoId) acciones.push({ clave: "ver", etiqueta: "Ver evento", icono: "ver", ayuda: "La ficha del evento, acá mismo", correr: () => setFicha(it.eventoId) });
            else if (gestionable) acciones.push({ clave: "ver", etiqueta: "Ver", icono: "ver", ayuda: "Abrirla en Gestión de alarmas", correr: () => router.push(`/admin/alarmas?ver=alarmas&id=${encodeURIComponent(clave)}`) });
            else if (it.plate) acciones.push({ clave: "hist", etiqueta: "Historial", icono: "historial", correr: () => router.push(`/admin/history?search=${encodeURIComponent(it.plate!)}`) });
            if (gestionable) {
                acciones.push(o?.soyYo
                    ? { clave: "pasar", etiqueta: "Pasar", icono: "pasar", ayuda: "Queda libre para que la tome otro compañero", correr: () => pasarGestion(clave, null, it.deviceId).then(() => setPulso((n) => n + 1)) }
                    : { clave: "tomar", etiqueta: "Tomar", icono: "tomar", ayuda: o?.operador ? `La tiene ${o.operador}` : "Queda a tu nombre", correr: () => tomarGestion(clave, it.deviceId).then(() => setPulso((n) => n + 1)) });
                acciones.push({ clave: "falsa", etiqueta: "Falsa", icono: "falsa", ayuda: it.claves.length > 1 ? `Las ${it.claves.length} lecturas del grupo` : "No era: queda como falsa en Gestión de alarmas", correr: () => decidir(it, "falsa") });
                acciones.push({ clave: "real", etiqueta: "Es real", icono: "real", principal: true, correr: () => decidir(it, "real") });
            }
        }
        return {
            id: it.id, tipo: it.tipo, nivel: it.nivel, ts: it.ts, foto: it.foto, rotulo: it.rotulo, titulo: it.titulo, detalle: it.detalle,
            veces: it.claves.length, acciones,
            operador: gestionable && !soloLectura ? (o?.soyYo ? "La atendés vos" : o?.operador ? `La atiende ${o.operador}` : null) : undefined,
            // Lo crítico no se quita sin decidir; en la pared (que no decide) sí, para no quedar tapada.
            cerrar: it.nivel === "critico" && !soloLectura ? undefined : () => setItems((p) => p.filter((x) => x.id !== it.id)),
        };
    }), [items, ops, soloLectura, decidir, router]);
    usePublicarAvisos("lpr", avisos);

    return ficha ? <FichaDeEvento id={ficha} alCerrar={() => setFicha(null)} /> : null;
}
