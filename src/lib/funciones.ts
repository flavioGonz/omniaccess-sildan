import type { ModuleId } from "@/lib/module-definitions";

/**
 * Las funciones que se prenden y se apagan DENTRO de un módulo.
 *
 * Un módulo es una instalación entera: LPR, rostro, filas. Una función es algo que ese
 * módulo puede hacer o no hacer sin dejar de ser él mismo. Las estadías son el primer
 * caso: un barrio que quiere saber qué autos quedaron estacionados y otro al que sólo le
 * importa quién entró y quién salió usan el mismo módulo LPR, y hasta ahora el primero era
 * el único posible porque estaba escrito en el código.
 *
 * Y no es un detalle de gusto. El seguimiento de estadías hace trabajo real: mantiene una
 * fila abierta por vehículo quieto, la releé, la vigila y la cierra. En una instalación
 * que no lo va a mirar nunca, eso es trabajo que no le sirve a nadie.
 *
 * Se guardan en Setting igual que los módulos, con la misma forma, para que el día que
 * haya una segunda función no haya que inventar un segundo mecanismo.
 */

export type FuncionId = "LPR_ESTADIAS" | "LPR_OCUPACION";

export interface Funcion {
    id: FuncionId;
    /** De qué módulo cuelga: apagado el módulo, la función no existe. */
    modulo: ModuleId;
    nombre: string;
    que: string;
    /** Lo que deja de pasar al apagarla. Se dice antes de apagar, no después. */
    siSeApaga: string;
    porDefecto: boolean;
    /**
     * De qué OTRA función depende, si depende de alguna.
     *
     * Hacía falta en cuanto apareció la segunda. El motor de ocupación no es una función
     * hermana de las estadías: es una MANERA de medirlas. Con las estadías apagadas no hay
     * nada que medir, así que prenderlo solo no significaría nada — y una pantalla que
     * ofrece prender algo que no va a hacer nada es exactamente la clase de control que
     * miente.
     *
     * Se declara acá y no se deduce en la pantalla para que el código que la lee (las
     * rutas del seguimiento) y el que la dibuja usen la misma verdad.
     */
    requiere?: FuncionId;
}

export const FUNCIONES: Funcion[] = [
    {
        id: "LPR_ESTADIAS",
        modulo: "MODULE_LPR",
        nombre: "Estadías y estacionamiento",
        que: "Sigue a los vehículos que quedan quietos frente a una cámara interior: cuánto llevan ahí, dónde están en el plano, y avisa cuando estacionan y cuando se retiran.",
        siSeApaga: "Las cámaras interiores siguen leyendo matrículas y el recorrido se sigue dibujando, pero ningún vehículo queda marcado como estacionado y el plano deja de mostrar autos parados.",
        porDefecto: true,
    },
    {
        id: "LPR_OCUPACION",
        modulo: "MODULE_LPR",
        requiere: "LPR_ESTADIAS",
        nombre: "Motor de ocupación por franja",
        que: "Mide el ESTACIONAMIENTO mirando el lugar y no la chapa: sobre la franja dibujada compara cada lugar contra su aspecto vacío, y así sabe si el auto sigue ahí aunque no se lo vuelva a leer.",
        siSeApaga: "Las cámaras con franja vuelven al criterio por matrícula: la permanencia se calcula releyendo la chapa, que es lo que hacen las cámaras sin franja. Se dejan de abrir y cerrar ocupaciones por lugar, y el plano deja de decir qué lugar ocupa cada vehículo.",
        porDefecto: true,
    },
];

/** ¿Está esta función habilitada por aquella de la que cuelga? */
export const dependenciaCumplida = (f: Funcion, estado: Record<string, boolean>) =>
    !f.requiere || (estado[f.requiere] ?? funcionPorId(f.requiere)?.porDefecto ?? true);

export const funcionPorId = (id: string) => FUNCIONES.find((f) => f.id === id);
