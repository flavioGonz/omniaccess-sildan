import { Camera, Video, HardDrive, ScanFace, DoorOpen, Phone, Users } from "lucide-react";

/**
 * Qué clase de equipo se está dando de alta.
 *
 * Esto es lo PRIMERO que se pregunta, y no por gusto: el tipo decide todo lo que viene
 * después —qué pasos hay, qué campos tienen sentido, si se pregunta el sentido de paso, si
 * hay canal de video que elegir. Antes estaba en el medio del primer paso, al lado de la
 * marca, como si fuera un dato más; y entonces el formulario ya había preguntado cosas que
 * quizá no correspondían.
 *
 * Cada tipo se explica en una línea porque el nombre no alcanza. "Cámara LPR" y "cámara
 * interior" son las dos cámaras que leen matrículas, y la diferencia —una abre la barrera,
 * la otra sólo mira— es la que decide cuál hay que elegir. Quien instala no siempre lo
 * sabe, y equivocarse manda la cámara al circuito equivocado.
 */
export const TIPOS_DE_EQUIPO = [
    {
        valor: "LPR_CAMERA",
        rotulo: "Cámara LPR de acceso",
        icono: Camera,
        que: "Lee la matrícula en la entrada o la salida y decide si se abre la barrera.",
        /** Si tiene sentido preguntarle por dónde pasa el vehículo. */
        sentido: true,
    },
    {
        valor: "LPR_INTERIOR",
        rotulo: "Cámara interior de seguimiento",
        icono: Video,
        que: "No abre nada. Mira una calle de adentro para dibujar por dónde anduvo cada vehículo.",
        sentido: false,
    },
    {
        valor: "NVR",
        rotulo: "Grabador (NVR)",
        icono: HardDrive,
        que: "Guarda el video de las cámaras. Se le mapea qué canal corresponde a cada una.",
        sentido: false,
    },
    {
        valor: "FACE_TERMINAL",
        rotulo: "Terminal de rostro",
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
        icono: Phone,
        que: "Llama a la casa desde la entrada y permite abrir desde adentro.",
        sentido: true,
    },
    {
        valor: "QUEUE_COUNTER",
        rotulo: "Contador de filas",
        icono: Users,
        que: "Cuenta cuánta gente hay y cuántos entran y salen de una zona.",
        sentido: false,
    },
] as const;

export type TipoDeEquipo = (typeof TIPOS_DE_EQUIPO)[number]["valor"];

export const tipoDeEquipo = (valor: string) =>
    TIPOS_DE_EQUIPO.find((t) => t.valor === valor);
