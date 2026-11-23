/**
 * Cómo se muestra el menú del panel en cada pantalla (23/11). Sólo la regla: sin React ni navegador,
 * para poder probarla.
 *
 * El menú tiene tres estados:
 *  · a la vista — entero, al costado, empujando la pantalla;
 *  · íconos     — la columna angosta, sin nombres;
 *  · oculto     — fuera de la pantalla; aparece flotando al acercar el mouse al borde.
 *
 * Y cuál le toca depende de PARA QUÉ es la pantalla, que es lo que Nico eligió («oculto o a la
 * vista»): en las de gestión —un padrón, un historial, los ajustes— se va y viene por el menú todo
 * el tiempo, y esconderlo obliga a llamarlo en cada paso; en las de mirar —los monitores y el mapa—
 * cada píxel es imagen y el menú no se toca en horas. El 13/11 se lo había ocultado en todas, que
 * era lo cómodo para la pared de cámaras y lo incómodo para todo lo demás.
 *
 * Lo que la persona cambia a mano se recuerda POR CLASE de pantalla, no por pantalla ni para todo:
 * quien lo clava en un monitor lo quiere en los monitores, y eso no dice nada de cómo lo quiere en
 * Residentes. Una sola preferencia para todo volvía a obligar a elegir entre las dos comodidades.
 */

export type EstadoMenu = "vista" | "iconos" | "oculto";
export type ClasePantalla = "gestion" | "mirar";

const ESTADOS: EstadoMenu[] = ["vista", "iconos", "oculto"];

/** Cómo sale de fábrica en cada clase de pantalla. */
export const MENU_DE_FABRICA: Record<ClasePantalla, EstadoMenu> = { gestion: "vista", mirar: "oculto" };

/**
 * Las pantallas de mirar: las que se dejan puestas. Los monitores, la pared y los dos mapas.
 * Gestión de alarmas NO está: es una bandeja que se atiende, con listas y fichas, y se sale de ella
 * hacia el historial o el padrón a cada rato.
 */
const DE_MIRAR = [
    "/admin/monitor-lpr", "/admin/monitor-face", "/admin/monitor-intrusion", "/admin/monitor-cctv", "/admin/monitor-queue",
    "/admin/monitores", "/admin/mapa", "/admin/mapas",
];

export function claseDePantalla(ruta: string): ClasePantalla {
    const r = (ruta || "").split("?")[0].replace(/\/+$/, "");
    return DE_MIRAR.some((m) => r === m || r.startsWith(m + "/")) ? "mirar" : "gestion";
}

/** Lo que eligió la persona en este navegador. Una clase sin elegir sigue la de fábrica. */
export type MenuElegido = Partial<Record<ClasePantalla, EstadoMenu>>;

/**
 * Lee lo guardado. `viejo` es la clave anterior (`oa.menu`), de cuando había una sola preferencia:
 * «fijo» era «lo quiero a la vista en todos lados», y se respeta en las dos clases. Su «oculto» no
 * se trae: era el estado de fábrica de entonces, no una elección, y traerlo dejaría a todos con el
 * menú escondido en las pantallas de gestión —justo lo que este cambio viene a sacar—.
 */
export function leerMenuElegido(crudo: string | null | undefined, viejo?: string | null): MenuElegido {
    const elegido: MenuElegido = viejo === "fijo" ? { gestion: "vista", mirar: "vista" } : {};
    if (!crudo) return elegido;
    try {
        const o = JSON.parse(crudo) as Record<string, unknown>;
        if (!o || typeof o !== "object") return elegido;
        for (const clase of ["gestion", "mirar"] as const) {
            const v = o[clase];
            if (typeof v === "string" && (ESTADOS as string[]).includes(v)) elegido[clase] = v as EstadoMenu;
        }
    } catch { /* guardado a medias o tocado a mano: vale lo de fábrica */ }
    return elegido;
}

export function guardarMenuElegido(elegido: MenuElegido, clase: ClasePantalla, estado: EstadoMenu): string {
    return JSON.stringify({ ...elegido, [clase]: estado });
}

/**
 * El estado que le toca a esta pantalla. En un celular es SIEMPRE oculto (flota al llamarlo): fijo
 * ocupa 256 px de los 390 que hay, y lo que queda no es una pantalla. La elección del escritorio no
 * se pierde: sigue guardada y vale al volver a una pantalla ancha.
 */
export function estadoDelMenu(elegido: MenuElegido, ruta: string, celular: boolean): EstadoMenu {
    if (celular) return "oculto";
    const clase = claseDePantalla(ruta);
    return elegido[clase] || MENU_DE_FABRICA[clase];
}

/** Para los carteles de los botones: dónde vale lo que se está por elegir. */
export const DONDE_VALE: Record<ClasePantalla, string> = { gestion: "en las pantallas de gestión", mirar: "en los monitores y el mapa" };
