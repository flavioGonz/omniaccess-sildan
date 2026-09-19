"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { getSocketUrl, opcionesSocket } from "@/lib/socket-config";

/**
 * El socket, una sola vez por pestaña.
 *
 * Cada pantalla abría el suyo, y no todas igual: `/admin/history` con `getSocketUrl()`,
 * `/admin/devices` con `window.location.origin`, `/admin/consolas` con `getSocketUrl()` y
 * sus propias opciones. Son tres maneras de escribir lo mismo, y el día que cambie el
 * proxy dos de las tres van a fallar mientras la tercera sigue andando — que es la peor
 * forma de romperse, porque parece que el problema es de la pantalla.
 *
 * Acá hay UNA conexión compartida. Abrir tres pantallas en pestañas distintas abre tres
 * conexiones, como corresponde; abrir tres tablas en la misma pantalla abre una.
 */

let compartido: Socket | null = null;
let clientes = 0;

function tomar(): Socket {
    if (!compartido) {
        compartido = io(getSocketUrl(), opcionesSocket());
    }
    clientes++;
    return compartido;
}

function soltar() {
    clientes = Math.max(0, clientes - 1);
    // No se cierra al instante: navegar entre dos pantallas que lo usan desmonta una y
    // monta la otra en el mismo cuadro, y cerrar en el medio costaría una reconexión.
    if (clientes === 0) {
        const s = compartido;
        setTimeout(() => {
            if (clientes === 0 && compartido === s) { s?.disconnect(); compartido = null; }
        }, 3000);
    }
}

/**
 * Escuchar un evento del servidor.
 *
 * El manejador se guarda en una referencia para que cambiarlo no reabra la suscripción:
 * un `useEffect` que dependa de una función definida en el render se vuelve a correr en
 * cada render, y con un socket eso es desuscribirse y suscribirse sesenta veces por
 * segundo sin que nadie lo note hasta que se pierde un evento.
 */
export function useTiempoReal<T = any>(evento: string, alLlegar: (dato: T) => void) {
    const [conectado, setConectado] = useState(false);
    const mano = useRef(alLlegar);
    useEffect(() => { mano.current = alLlegar; }, [alLlegar]);

    useEffect(() => {
        const s = tomar();
        setConectado(s.connected);
        const arriba = () => setConectado(true);
        const abajo = () => setConectado(false);
        const rebote = (d: T) => mano.current(d);
        s.on("connect", arriba);
        s.on("disconnect", abajo);
        s.on(evento, rebote);
        return () => {
            s.off("connect", arriba);
            s.off("disconnect", abajo);
            s.off(evento, rebote);
            soltar();
        };
    }, [evento]);

    return { conectado };
}

/**
 * Las filas que acaban de llegar, para el destello.
 *
 * Una fila que aparece de golpe arriba de una lista que se está leyendo se siente como un
 * error de la pantalla. El destello dice "esto es nuevo" durante dos segundos y después la
 * fila se vuelve una más, que es lo que es.
 */
export function useDestello(ms = 2200) {
    const [nuevas, setNuevas] = useState<Set<string>>(new Set());
    const relojes = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    const marcar = (clave: string) => {
        setNuevas((s) => new Set(s).add(clave));
        const anterior = relojes.current.get(clave);
        if (anterior) clearTimeout(anterior);
        relojes.current.set(clave, setTimeout(() => {
            setNuevas((s) => { const n = new Set(s); n.delete(clave); return n; });
            relojes.current.delete(clave);
        }, ms));
    };

    useEffect(() => () => { relojes.current.forEach(clearTimeout); relojes.current.clear(); }, []);

    return { nuevas, marcar, es: (clave: string) => nuevas.has(clave) };
}
