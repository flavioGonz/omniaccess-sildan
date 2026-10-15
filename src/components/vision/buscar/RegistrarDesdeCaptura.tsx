"use client";

import { useState } from "react";
import { RegistrarMatricula } from "@/components/registro/RegistrarMatricula";
import { CajonListaNegra } from "@/components/users/CajonListaNegra";
import { getUnits } from "@/app/actions/units";
import { getAccessGroups } from "@/app/actions/groups";
import { getDevices } from "@/app/actions/devices";
import { getParkingSlots } from "@/app/actions/plazas";
import { img, fecha, hora, type FilaObjeto } from "@/components/vision/ObjetoRegistro";
import type { HistorialPista } from "@/lib/vision-historial";

/**
 * Registrar desde una captura de OmniVision: la matrícula (residente, personal, proveedor o
 * lista negra, con el selector del monitor de LPR) o una lista negra con la foto de la captura.
 * Lo usan Buscar, Detecciones y Relecturas; antes iba escrito en Buscar y se iba a copiar.
 *
 * Devuelve las dos acciones y los cajones, que la pantalla pone una vez al final.
 */
export function useRegistrarDesdeCaptura(alCambiar?: () => void) {
    const [registrar, setRegistrar] = useState<string | null>(null);
    const [listas, setListas] = useState<{ units: any[]; groups: any[]; devices: any[]; parkingSlots: any[] } | null>(null);
    const [negra, setNegra] = useState<{ foto: File | null; motivo: string; chapa?: string } | null>(null);

    const abrirRegistro = (plate: string) => {
        setRegistrar(plate);
        // Las listas del alta (lotes, grupos, equipos, plazas) recién cuando hacen falta.
        if (!listas) Promise.all([getUnits(), getAccessGroups(), getDevices(), getParkingSlots()])
            .then(([u, g, d, p]: any) => setListas({ units: u || [], groups: g || [], devices: d || [], parkingSlots: p || [] }))
            .catch(() => setListas({ units: [], groups: [], devices: [], parkingSlots: [] }));
    };
    /** Lista negra con la captura: el recorte del objeto como foto del registro, y de dónde salió como motivo. */
    const marcarNegra = async (f: Pick<FilaObjeto, "id" | "recorte" | "foto" | "camara" | "primeraVez"> & { historial?: HistorialPista | null }, chapa?: string | null) => {
        let foto: File | null = null;
        try {
            const clave = f.recorte || f.foto;
            if (clave) { const b = await (await fetch(img(clave))).blob(); foto = new File([b], `captura-${f.id}.jpg`, { type: b.type || "image/jpeg" }); }
        } catch { /* sin foto: se carga a mano */ }
        setNegra({ foto, motivo: `Visto por OmniVision en ${f.camara}, ${fecha(f.primeraVez)} ${hora(f.primeraVez)}.`, chapa: chapa || f.historial?.lectura?.plate || undefined });
    };

    const cajones = (
        <>
            <RegistrarMatricula plate={registrar} alCerrar={() => setRegistrar(null)} alTerminar={() => { setRegistrar(null); alCambiar?.(); }}
                units={listas?.units || []} groups={listas?.groups || []} devices={listas?.devices || []} parkingSlots={listas?.parkingSlots || []} />
            <CajonListaNegra abierta={!!negra} ficha={null} chapaInicial={negra?.chapa} fotoInicial={negra?.foto} motivoInicial={negra?.motivo}
                alCerrar={() => setNegra(null)} alCambiar={() => alCambiar?.()} />
        </>
    );
    return { abrirRegistro, marcarNegra, cajones };
}
