import type { DriverCentral } from "./tipos";

/** Cualquier central que hable DC-09: OmniAccess no le escribe nada, el instalador carga los datos. */
export const generica: DriverCentral = {
    modelo: "generica",
    nombre: "Genérica (SIA DC-09)",
    probado: true,
    ayudaAlta: "En la central, como receptor (ARC / centro receptor): la dirección y el puerto de OmniAccess, la cuenta, el protocolo SIA-DCS o ADM-CID cifrado, y la clave. Supervisión: la prueba periódica o NULL cada pocos minutos.",
};
