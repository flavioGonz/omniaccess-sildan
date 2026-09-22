"use client";

/**
 * Los avisos de la aplicación, con la forma que ya usan 24 archivos.
 *
 * ## El defecto que esto arregla
 *
 * Veinticuatro archivos hacían `import { toast } from "sonner"` y entre todos suman 132
 * llamadas. Pero en toda la aplicación **el único `<Toaster>` montado es el de sileo**
 * (`ThemedToaster`, en el layout raíz). El de sonner no está en ninguna parte.
 *
 * O sea que esas 132 llamadas **no mostraban nada**. Ni el éxito, ni el error. El código
 * creía haberle dicho algo al operador y el operador no veía nada: apretaba "Guardar
 * guardia", el guardia se guardaba o no, y la pantalla se quedaba igual en los dos casos.
 * Entre esos avisos invisibles están los del botón de pánico de la bitácora y los errores
 * de la carga manual de accesos.
 *
 * No es deuda de estilo: es la clase de defecto más caro que tiene este proyecto — algo
 * que se ve bien, no funciona, y no deja rastro en ninguna consola.
 *
 * ## Por qué una fachada y no reescribir 132 llamadas
 *
 * Las dos librerías tienen APIs distintas: sonner recibe un texto suelto
 * (`toast.error("no se pudo")`) y sileo recibe un objeto (`{ title, description }`).
 * Reescribir cada llamada a mano son 132 oportunidades de cambiar un mensaje sin querer, en
 * archivos que hoy nadie está tocando.
 *
 * Con esta fachada cada archivo cambia UNA línea —el import— y los mensajes quedan
 * exactamente como estaban. La conversión vive en un solo lugar, que es además el único
 * lugar donde hay que tocar si algún día se cambia de librería otra vez.
 *
 * El código nuevo usa `sileo` directo: tiene título y descripción separados, que es mejor.
 * Esta fachada es para lo que ya está escrito.
 */

import type { ReactNode } from "react";
import { sileo } from "sileo";

/** Lo que sonner aceptaba como segundo argumento y acá tiene sentido conservar. */
type Opciones = {
    description?: ReactNode;
    duration?: number | null;
    icon?: ReactNode | null;
};

type Mensaje = ReactNode;

/**
 * El texto va al TÍTULO y no a la descripción.
 *
 * En sileo el globo nace colapsado mostrando el título, y se expande para mostrar la
 * descripción. Un mensaje puesto sólo en la descripción aparecería en un globo sin nada
 * escrito arriba, y recién se leería al expandirse. Los mensajes que vienen de sonner son
 * una frase corta: son títulos.
 */
const armar = (mensaje: Mensaje, o?: Opciones) => ({
    title: typeof mensaje === "string" ? mensaje : undefined,
    description: o?.description ?? (typeof mensaje === "string" ? undefined : mensaje),
    ...(o?.duration !== undefined ? { duration: o.duration } : {}),
    ...(o?.icon !== undefined ? { icon: o.icon } : {}),
});

function base(mensaje: Mensaje, o?: Opciones) {
    return sileo.show(armar(mensaje, o));
}

export const toast = Object.assign(base, {
    success: (m: Mensaje, o?: Opciones) => sileo.success(armar(m, o)),
    error: (m: Mensaje, o?: Opciones) => sileo.error(armar(m, o)),
    warning: (m: Mensaje, o?: Opciones) => sileo.warning(armar(m, o)),
    info: (m: Mensaje, o?: Opciones) => sileo.info(armar(m, o)),
    /**
     * `toast.custom` de sonner dibujaba una tarjeta propia en lugar del globo. sileo no
     * tiene eso, así que la tarjeta entra como descripción: se ve, que es infinitamente
     * mejor que hoy, pero queda una tarjeta adentro de un globo.
     *
     * PENDIENTE: los dos usos que quedan (alertas de aforo con foto, en el módulo de filas)
     * quieren ser un componente propio sobre el mapa, no un aviso. Ver
     * `claude/pendientes-san-nicolas.md`.
     */
    custom: (render: () => ReactNode, o?: Opciones) =>
        sileo.show({ description: render(), icon: null, ...(o?.duration !== undefined ? { duration: o.duration } : {}) }),
    dismiss: (id?: string) => (id ? sileo.dismiss(id) : sileo.clear()),
    /** sonner tenía `loading`; sileo lo expresa como un estado del propio globo. */
    loading: (m: Mensaje, o?: Opciones) => sileo.show({ ...armar(m, o), duration: null }),
});

export default toast;
