"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { claseDePantalla, estadoDelMenu, guardarMenuElegido, leerMenuElegido, type EstadoMenu } from "@/lib/menu-estado";

/**
 * El estado del menú lateral, del lado del navegador (23/11). La regla —qué estado le toca a cada
 * pantalla— está en lib/menu-estado.ts; acá está lo que necesita un navegador: dónde se guarda lo
 * elegido, si la pantalla es un celular, y el ir y venir del menú cuando está oculto.
 *
 * Estaba todo dentro del layout del panel, mezclado con las alarmas y los avisos. Salió a un gancho
 * porque con tres estados y dos clases de pantalla ya no era «un booleano y un alfiler».
 */

/** El ancho del menú desplegado (w-64) y cuánto más allá puede irse el mouse sin que se esconda. */
const MENU_ANCHO_PX = 256;
const MENU_MARGEN_PX = 28;

const CLAVE = "oa.menu.v2";
/* Las claves de antes: `oa.menu` cuando había una sola preferencia para todo, y `oa.cctv.menu`
   cuando el menú oculto valía sólo para Monitor CCTV. Se leen, no se vuelven a escribir. */
const CLAVES_VIEJAS = ["oa.menu", "oa.cctv.menu"];
const EN_CELULAR = "(max-width: 639px)";

/* ── Lo elegido, guardado en este navegador ──────────────────────────────────────────────────────
   Se lee con useSyncExternalStore y no con un efecto que hace setState: así el primer dibujo en el
   navegador ya sale con lo guardado, sin un cuadro con el menú de fábrica antes. La copia en memoria
   es la que manda —el almacenamiento puede no estar (modo privado, bloqueado)— y los botones siguen
   andando igual, sólo que no se recuerda al recargar. */
let leido = false;
let crudo: string | null = null;
let viejo: string | null = null;
const oyentes = new Set<() => void>();

function cargar() {
    if (leido) return;
    leido = true;
    try {
        crudo = localStorage.getItem(CLAVE);
        viejo = CLAVES_VIEJAS.map((k) => localStorage.getItem(k)).find((v) => v != null) ?? null;
    } catch { /* sin almacenamiento: lo de fábrica */ }
}
function suscribir(avisar: () => void) {
    oyentes.add(avisar);
    // Otra pestaña del mismo puesto cambió el menú: esta lo sigue.
    const otra = (e: StorageEvent) => { if (e.key === CLAVE) { crudo = e.newValue; avisar(); } };
    window.addEventListener("storage", otra);
    return () => { oyentes.delete(avisar); window.removeEventListener("storage", otra); };
}
/* La instantánea tiene que ser un valor que no cambie de identidad entre lecturas: un texto. */
const instantanea = () => { cargar(); return `${viejo === "fijo" ? "fijo" : ""}|${crudo ?? ""}`; };
const instantaneaServidor = () => "|";
function guardar(nuevo: string) {
    crudo = nuevo;
    try { localStorage.setItem(CLAVE, nuevo); } catch { /* idem */ }
    oyentes.forEach((f) => f());
}

function useCelular() {
    return useSyncExternalStore(
        (avisar) => { const m = window.matchMedia(EN_CELULAR); m.addEventListener("change", avisar); return () => m.removeEventListener("change", avisar); },
        () => window.matchMedia(EN_CELULAR).matches,
        () => false,
    );
}

export function useMenuLateral(ruta: string, consulta: string) {
    const guardado = useSyncExternalStore(suscribir, instantanea, instantaneaServidor);
    const elegido = useMemo(() => { const corte = guardado.indexOf("|"); return leerMenuElegido(guardado.slice(corte + 1) || null, guardado.slice(0, corte) || null); }, [guardado]);
    const celular = useCelular();
    const clase = claseDePantalla(ruta);
    const estado = estadoDelMenu(elegido, ruta, celular);
    const elegir = (e: EstadoMenu) => guardar(guardarMenuElegido(elegido, clase, e));

    /*
     * Oculto, el menú se llama acercando el mouse al borde izquierdo (o tocando la pestaña): aparece
     * FLOTANDO sobre la pantalla, sin empujarla —una pared de cámaras no se reacomoda ni reconecta—,
     * y se va al sacarle el mouse, al elegir adónde ir, con Esc o tocando afuera.
     *
     * «Asomado» se anota junto con el lugar donde se lo llamó: al cambiar de pantalla deja de valer
     * solo —se eligió adónde ir, el menú ya cumplió— sin un efecto que lo apague.
     */
    const sinMenu = estado === "oculto";
    const lugar = `${ruta}?${consulta}`;
    const [asomadoEn, setAsomadoEn] = useState<string | null>(null);
    const asomado = sinMenu && asomadoEn === lugar;
    /* Sacar el mouse lo esconde con una pausa: al rozar el borde de la ventana el navegador avisa
       «salió», y sin pausa el menú se cerraba en la cara. Volver a entrar la cancela. */
    const irse = useRef<ReturnType<typeof setTimeout> | null>(null);
    const quedarse = () => { if (irse.current) { clearTimeout(irse.current); irse.current = null; } };
    const asomar = () => { quedarse(); setAsomadoEn(lugar); };
    const cerrar = () => { quedarse(); setAsomadoEn(null); };
    const esconder = (ms = 260) => { quedarse(); irse.current = setTimeout(() => { irse.current = null; setAsomadoEn(null); }, ms); };
    useEffect(() => () => { if (irse.current) clearTimeout(irse.current); }, []);
    /* Una pantalla puede pedir el menú con su propio botón (Gestión GPS lo hace en el celular, donde
       la pestaña del borde es fina para un pulgar): avisa con `oa:menu` y acá se lo asoma. */
    useEffect(() => {
        const abrir = () => { if (irse.current) { clearTimeout(irse.current); irse.current = null; } setAsomadoEn(lugar); };
        window.addEventListener("oa:menu", abrir);
        return () => window.removeEventListener("oa:menu", abrir);
    }, [lugar]);
    /*
     * Cuándo se va: por DÓNDE está el mouse, no por «entró / salió» del menú. El menú llega
     * deslizándose debajo de un puntero que quizá está quieto, y el navegador no avisa «entró»
     * hasta que el puntero se mueve; con entradas y salidas quedaba abierto para siempre si el
     * mouse se iba antes de que el menú llegara (visto al probarlo). Lejos del menú, se va.
     */
    useEffect(() => {
        if (!asomado) return;
        const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") setAsomadoEn(null); };
        const mouse = (e: MouseEvent) => {
            if (e.clientX > MENU_ANCHO_PX + MENU_MARGEN_PX) { if (!irse.current) irse.current = setTimeout(() => { irse.current = null; setAsomadoEn(null); }, 260); }
            else if (irse.current) { clearTimeout(irse.current); irse.current = null; }
        };
        window.addEventListener("keydown", tecla); window.addEventListener("mousemove", mouse);
        return () => { window.removeEventListener("keydown", tecla); window.removeEventListener("mousemove", mouse); };
    }, [asomado]);

    /* Las transiciones se prenden un instante después de aparecer: lo guardado llega apenas el
       navegador toma la página, y con la transición puesta desde el vamos el menú se achicaba o se
       iba deslizando en cada recarga, como si alguien lo hubiera tocado. */
    const [animar, setAnimar] = useState(false);
    useEffect(() => { const t = setTimeout(() => setAnimar(true), 120); return () => clearTimeout(t); }, []);

    return {
        /** El estado que le toca a esta pantalla, ya con el celular y lo elegido a mano. */
        estado, clase, celular,
        /** Oculto: no ocupa lugar; puede estar asomado, flotando. */
        sinMenu, asomado,
        /** Sólo íconos. */
        plegado: estado === "iconos",
        elegir, asomar, cerrar, esconder, animar,
    };
}
