import { Camera, Video, HardDrive, ScanFace, DoorOpen, Phone, Users } from "lucide-react";
import type { ModuleId } from "@/lib/module-definitions";

/**
 * Qué clase de equipo se está dando de alta.
 *
 * Esto es lo PRIMERO que se pregunta, y no por gusto: el tipo decide todo lo que viene
 * después —qué pasos hay, qué campos tienen sentido, si se pregunta el sentido de paso, si
 * hay canal de video que elegir. Antes estaba en el medio del primer paso, al lado de la
 * marca, como si fuera un dato más; y entonces el formulario ya había preguntado cosas que
 * quizá no correspondían.
 *
 * **Y sólo se ofrecen los que corresponden al modo.** OmniAccess se instala como LPR, como
 * Face o como Control de Filas, y cada barrio tiene prendido lo suyo: San Nicolás tiene LPR
 * y nada más. Ofrecer "terminal de rostro" ahí no es una opción de más, es una trampa —
 * alguien lo carga, no aparece en ninguna pantalla porque el módulo está apagado, y a
 * averiguar por qué.
 *
 * `modulo` dice de cuál depende. Los que no lo declaran son transversales y están siempre:
 * un grabador guarda el video de cualquier cámara, y una lectora de tarjeta o un portero
 * sirven igual en las tres clases de instalación.
 *
 * Cada tipo se explica en una línea porque el nombre no alcanza. "Cámara LPR" y "cámara
 * interior" son las dos cámaras que leen matrículas, y la diferencia —una abre la barrera,
 * la otra sólo mira— es la que decide cuál hay que elegir. Quien instala no siempre lo
 * sabe, y equivocarse manda la cámara al circuito equivocado.
 */
export const TIPOS_DE_EQUIPO = [
    {
        valor: "LPR_CAMERA",
        modulo: "MODULE_LPR" as ModuleId,
        rotulo: "Cámara LPR de acceso",
        /** Se le puede mostrar el video en vivo al final del alta. */
        vivo: true,
        icono: Camera,
        que: "Lee la matrícula en la entrada o la salida y decide si se abre la barrera.",
        /** Si tiene sentido preguntarle por dónde pasa el vehículo. */
        sentido: true,
    },
    {
        valor: "LPR_INTERIOR",
        modulo: "MODULE_LPR" as ModuleId,
        rotulo: "Cámara interior de seguimiento",
        /** Hay que preguntarle COMO avisa que paso un vehículo. */
        aviso: true,
        /** Tiene un canal RTSP propio que lee la pasarela. */
        video: true,
        vivo: true,
        icono: Video,
        que: "No abre nada. Mira una calle de adentro para dibujar por dónde anduvo cada vehículo.",
        sentido: false,
    },
    {
        valor: "NVR",
        rotulo: "Grabador (NVR)",
        /** Hay que decirle qué cámara es cada canal. */
        canales: true,
        icono: HardDrive,
        que: "Guarda el video de las cámaras. Se le mapea qué canal corresponde a cada una.",
        sentido: false,
    },
    {
        valor: "CAMERA",
        rotulo: "Cámara de vigilancia",
        /** Tiene vivo (directo o a través del grabador que la tiene en un canal). */
        vivo: true,
        icono: Video,
        que: "No lee matrículas: vigila. Es la que usa el monitor de intrusión (cruce de línea y zona). Lo normal es importarla desde los canales del grabador, no cargarla a mano.",
        sentido: false,
    },
    {
        valor: "FACE_TERMINAL",
        modulo: "MODULE_FACE" as ModuleId,
        rotulo: "Terminal de rostro",
        vivo: true,
        icono: ScanFace,
        que: "Reconoce la cara de quien se presenta y abre si está cargada.",
        sentido: true,
    },
    {
        valor: "ACCESS_CONTROL",
        rotulo: "Control de acceso",
        icono: DoorOpen,
        que: "Lectora de tarjeta, llavero o teclado que comanda una puerta o un molinete.",
        sentido: true,
    },
    {
        valor: "DOOR_INTERCOM",
        rotulo: "Portero IP",
        vivo: true,
        icono: Phone,
        que: "Llama a la casa desde la entrada y permite abrir desde adentro.",
        sentido: true,
    },
    {
        valor: "QUEUE_COUNTER",
        modulo: "MODULE_QUEUE" as ModuleId,
        rotulo: "Contador de filas",
        vivo: true,
        icono: Users,
        que: "Cuenta cuánta gente hay y cuántos entran y salen de una zona.",
        sentido: false,
    },
] as const;

export type TipoDeEquipo = (typeof TIPOS_DE_EQUIPO)[number]["valor"];

/**
 * Lo que cada clase de equipo necesita que le pregunten.
 *
 * El `as const` del catálogo hace que las propiedades que un tipo no declara no existan
 * en su objeto, en vez de estar en undefined. Eso es lo que mantiene `valor` como literal
 * y no como string cualquiera, pero obliga a leerlas de costado. Este tipo junta las
 * cuatro banderas en un solo lugar para no repetir el truco en cada uso.
 */
export type RasgosDeEquipo = {
    /** Preguntarle cómo avisa que pasó un vehículo (cruce de línea, zona o sólo RTSP). */
    aviso?: boolean;
    /** Tiene un canal RTSP propio. */
    video?: boolean;
    /** Hay que mapearle los canales a las cámaras. */
    canales?: boolean;
    /** Se le puede mostrar el video en vivo. */
    vivo?: boolean;
    /** Tiene sentido preguntarle por dónde pasa la gente. */
    sentido?: boolean;
};

export const tipoDeEquipo = (valor: string) =>
    TIPOS_DE_EQUIPO.find((t) => t.valor === valor) as
        (typeof TIPOS_DE_EQUIPO)[number] & RasgosDeEquipo | undefined;

/**
 * Los tipos que se pueden dar de alta con los módulos que este barrio tiene prendidos.
 *
 * Sin la lista de módulos se devuelven todos, a propósito: es lo que pasa mientras la
 * consulta viaja, y esconder opciones por un dato que todavía no llegó se ve como un
 * parpadeo de cosas que aparecen solas.
 */
export function tiposSegunModulos(modulos?: Partial<Record<ModuleId, boolean>> | null) {
    if (!modulos) return TIPOS_DE_EQUIPO;
    return TIPOS_DE_EQUIPO.filter((t) => {
        /* El `as const` del catálogo deja los tipos transversales sin la propiedad, no con
           ella en undefined, así que hay que preguntarla de costado. Vale la pena: es lo
           que hace que `valor` sea un literal y no un string cualquiera. */
        const mod = (t as { modulo?: ModuleId }).modulo;
        return !mod || !!modulos[mod];
    });
}
