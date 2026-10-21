/**
 * La búsqueda inteligente en el GRABADOR, sin el nombre del fabricante.
 *
 * 21/10, Nico: «al tener NVR VPro se activa la búsqueda inteligente, pero pretendo que otros
 * fabricantes que tengan lo mismo se puedan integrar sin llamar a sus funciones como AcuSeek: sólo
 * tengo que saber si podemos hacer búsquedas (multimodales) o no, y mapear cada fabricante a su
 * driver». Hasta acá todo decía AcuSeek/AcuSearch, de la ruta a la pantalla.
 *
 * Ahora la pantalla y las rutas hablan de «buscar en el grabador» por TEXTO o por IMAGEN, y cada
 * fabricante es un driver que dice qué sabe hacer y lo hace a su manera (Hikvision: AcuSeek por
 * texto y AcuSearch por imagen). Sumar otro fabricante es escribir su driver y registrarlo en
 * drivers.ts; nada más cambia.
 */
export type ConexionGrabador = { ip: string; username: string; password: string; authType?: string };

/** Lo que un grabador sabe buscar, y si lo tiene habilitado (puede tenerlo en el firmware y sin licencia). */
export type CapacidadesBusqueda = { texto: boolean; imagen: boolean; activa: boolean; motivo?: string };

/** Un resultado, igual venga del fabricante que venga. Las URLs son del grabador (se sirven por el proxy). */
export type HallazgoGrabador = {
    id: string;
    canal: number;
    momento: string;
    /** 0–100, si el grabador lo da. */
    puntaje: number | null;
    foto: string | null;
    recorte: string | null;
    /** Caja del objeto en la foto, normalizada 0–1. */
    caja: { x: number; y: number; w: number; h: number } | null;
    clase?: string | null;
    atributos?: Record<string, string>;
};

export type AvanceBusqueda = { terminada: boolean; progreso: number; total: number; hallazgos: HallazgoGrabador[]; error?: string };

/**
 * En qué canales sabe buscar el grabador (21/10, Nico: «tengo que saber en qué canales se puede
 * buscar, poder activarlo o no; no sé si busca en todos»). No busca en todos: el grabador analiza
 * sólo los canales que tiene encendidos para eso, y lo que no analizó no lo encuentra. null = el
 * grabador no dice (ese tipo de búsqueda no lo tiene, o no expone la lista).
 */
export type CanalesBusqueda = {
    texto: number[] | null; imagen: number[] | null;
    /**
     * Los canales que PUEDEN buscar, prendidos o no (null = el grabador no lo dice). En los VPro
     * son las cámaras que le dan su análisis al grabador (Dual-VCA); una 180° o una cámara vieja
     * no, y el grabador rechaza prenderlas.
     */
    posibles?: number[] | null;
};
/** Resultado de cambiar los canales. `reinician`: las cámaras que el grabador reinicia para aplicarlo. */
export type CambioCanales = { ok: boolean; reinician: number[]; error?: string };

export type ParamsBusqueda = { desde: string; hasta: string; similitud?: number; canales?: number[] };

export interface DriverBusqueda {
    /** Cómo se llama el motor de ese fabricante, sólo para mostrar (p. ej. «AcuSeek»). */
    motor: string;
    capacidades(c: ConexionGrabador): Promise<CapacidadesBusqueda>;
    buscarTexto?(c: ConexionGrabador, texto: string, p: ParamsBusqueda): Promise<string>;
    avanceTexto?(c: ConexionGrabador, tarea: string, max: number): Promise<AvanceBusqueda>;
    buscarImagen?(c: ConexionGrabador, imagen: Buffer, p: ParamsBusqueda & { objeto: "persona" | "vehiculo" }): Promise<string>;
    avanceImagen?(c: ConexionGrabador, tarea: string, max: number, objeto: "persona" | "vehiculo"): Promise<AvanceBusqueda>;
    /** Una imagen de un resultado (las URLs piden la autenticación del grabador). */
    imagen(c: ConexionGrabador, url: string): Promise<{ buf: Buffer; tipo: string }>;
    /** Los canales que analiza para cada búsqueda. */
    canales?(c: ConexionGrabador): Promise<CanalesBusqueda>;
    /**
     * Fija la lista de canales que analiza para un tipo de búsqueda. Con `soloProbar` no cambia
     * nada: dice qué cámaras habría que reiniciar, para avisarlo antes.
     */
    ponerCanales?(c: ConexionGrabador, tipo: "texto" | "imagen", canales: number[], soloProbar?: boolean): Promise<CambioCanales>;
    cerrar?(c: ConexionGrabador, tarea: string, tipo: "texto" | "imagen", objeto?: "persona" | "vehiculo"): Promise<void>;
}
