"use client";

import { useCallback, useEffect, useState } from "react";
import { Pista } from "@/components/ui/pista";

/**
 * La franja de servicios: qué está arriba y qué no, de un vistazo.
 *
 * Existe por un incidente concreto: el lector estuvo veintitrés minutos caído y nadie se
 * enteró, porque la única señal era un punto rojo en un nodo de un diagrama que hay que ir
 * a buscar. Esto va arriba de todo, en la pantalla que ya se mira.
 *
 * ## Los tres estados, y por qué son tres y no dos
 *
 * Arriba · caído · **y "no sé"**. El tercero es el que casi siempre falta y el que más
 * importa: si el vigía dejó de escribir, lo guardado es viejo y todo figuraría en verde.
 * Un panel que dice "todo bien" porque quien mira dejó de mirar es peor que un panel en
 * rojo. Por eso, cuando el parte no está fresco, la franja se declara a ciegas en vez de
 * mostrar servicios verdes.
 *
 * ## Sólo se nombra lo que está mal
 *
 * Listar los once servicios siempre convierte la franja en ruido, y una franja que es
 * ruido deja de mirarse — que es exactamente cómo nació este problema.
 */

type Servicio = { id: string; caido: boolean; detalle: string; desde: string | null };
type Estado = {
    hay: boolean; motivo?: string; al?: string | null;
    vigente?: boolean; haceSegundos?: number | null; servicios?: Servicio[];
};

/** Nombres para la gente: el id es interno y no le dice nada a quien mira el panel. */
const NOMBRES: Record<string, string> = {
    "base": "Base de datos",
    "redis": "Redis",
    "web": "Sitio",
    "webhooks": "Webhooks",
    "lector:contenedor": "Lector (contenedor)",
    "lector:api": "Lector (API)",
    "vision:contenedor": "omni-vision (contenedor)",
    "vision:api": "omni-vision (API)",
    "pm2:vision-worker": "Visión (registro y análisis)",
    "pm2:omniaccess-web": "Proceso del sitio",
    "pm2:omniaccess-webhooks": "Proceso de webhooks",
    "pm2:tracking-worker": "Pasarela de cuadros",
    "pm2:dispatch-worker": "Despachos",
    "pm2:omniaccess-vigia": "Vigía",
};

const rotulo = (id: string) => NOMBRES[id] || id;

const hace = (desde: string | null) => {
    if (!desde) return "";
    const min = Math.round((Date.now() - Date.parse(desde)) / 60000);
    if (!Number.isFinite(min)) return "";
    return min < 60 ? `hace ${min} min` : `hace ${Math.floor(min / 60)} h ${min % 60} min`;
};

export function FranjaServicios() {
    const [e, setE] = useState<Estado | null>(null);

    const cargar = useCallback(async () => {
        try {
            const r = await fetch("/api/vigia/estado", { cache: "no-store" });
            setE(await r.json());
        } catch {
            // Que no se pueda preguntar es, en sí mismo, una señal: se deja en "no sé".
            setE({ hay: false, motivo: "no se pudo consultar el estado" });
        }
    }, []);

    useEffect(() => {
        cargar();
        const t = setInterval(cargar, 20000);
        return () => clearInterval(t);
    }, [cargar]);

    if (!e) return null;

    if (!e.hay || !e.vigente) {
        const razon = !e.hay
            ? (e.motivo || "el vigía no escribió nada")
            : `el último parte es de hace ${Math.round((e.haceSegundos || 0) / 60)} min`;
        return (
            <div className="rounded-[10px] border border-border px-3 py-2 flex flex-wrap items-center gap-2 text-[12px]">
                <span className="chip-aviso">Sin vigilancia</span>
                <span className="text-muted-foreground">
                    No hay un parte fresco de los servicios — {razon}. Lo de abajo puede estar viejo.
                </span>
            </div>
        );
    }

    const servicios = e.servicios || [];
    const caidos = servicios.filter((s) => s.caido);

    return (
        <div className="rounded-[10px] border border-border px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px]">
            {caidos.length === 0 ? (
                <span className="chip-bien">Todo arriba</span>
            ) : (
                <span className="chip-mal">
                    {caidos.length === 1 ? "1 servicio caído" : `${caidos.length} servicios caídos`}
                </span>
            )}

            {caidos.map((s) => (
                <Pista key={s.id} titulo={rotulo(s.id)} texto={s.detalle || "sin detalle"}>
                    <span className="tono-mal font-semibold">
                        {rotulo(s.id)}
                        {s.desde && (
                            <span className="font-normal text-muted-foreground"> · {hace(s.desde)}</span>
                        )}
                    </span>
                </Pista>
            ))}

            <span className="ml-auto text-muted-foreground tabular-nums">
                {servicios.length} servicios · revisado hace {e.haceSegundos ?? "?"} s
            </span>
        </div>
    );
}
