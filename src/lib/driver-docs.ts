import type { DeviceBrand } from "@/lib/driver-models";

/**
 * Documentación de obra por driver: las guías que se abren desde Ajustes → Drivers → (marca) →
 * Documentación. Los PDF viven en public/drivers/<marca>/ y se sirven como archivos estáticos,
 * sin pedir sesión (medido el 2/11: 200 sin cookie). Por eso acá va sólo material que se puede
 * entregar a un cliente o instalador: nada con direcciones, claves ni datos de una instalación.
 *
 * Se arman fuera del repo (OmniAccess-Comercial/generadores) y acá se copia el PDF final. Para
 * sumar una guía: copiar el PDF y agregar su renglón; la pestaña aparece sola en esa marca.
 */
export type DocDriver = {
    titulo: string;
    /** Una frase: para qué sirve, dicha como la busca un instalador. */
    que: string;
    archivo: string;
    paginas: number;
    /** Fecha de la versión, para saber si la que uno bajó es la última. */
    version: string;
    temas: string[];
};

export const DOCS_DRIVER: Partial<Record<DeviceBrand, DocDriver[]>> = {
    HIKVISION: [
        {
            titulo: "Cámaras LPR serie 7: guía de obra",
            que: "Dónde y cómo instalar una LPR Hikvision serie 7 para que lea todas las chapas, cómo configurarla y qué hace OmniAccess al darla de alta.",
            archivo: "/drivers/hikvision/OmniAccess-LPR-Hikvision-Serie7.pdf",
            paginas: 9,
            version: "2/11/2026",
            temas: ["Altura y ángulos", "Entrada/Salida o Ciudad", "Imagen día y noche", "Línea y área de detección", "Puesta a punto en OmniAccess", "Lista de obra"],
        },
    ],
};
