"use client";

import { useEffect } from "react";
import { getFunciones } from "@/app/actions/funciones";
import { fijarMarcasCamara } from "@/lib/marca-vehiculo";

/** Lee una vez la función LPR_MARCAS y la fija para todo el panel (ver lib/marca-vehiculo). */
export function CargarMarcasCamara() {
    useEffect(() => { getFunciones().then((f) => fijarMarcasCamara(!!f.LPR_MARCAS)).catch(() => { }); }, []);
    return null;
}
