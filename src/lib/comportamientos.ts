/**
 * Los comportamientos de OmniVision, explicados (21/10, Nico: «animar mejor los otros comportamientos,
 * indicar cómo funcionan claramente»). Un solo lugar para el qué y el cómo de cada regla: la ficha
 * del evento, Gestión de alarmas y el asistente de reglas leen esto, y dibujan la escena animada de
 * components/vision/EscenaComportamiento con la misma clave.
 *
 * Los números de los textos son los de vision-reglas.js (el worker): si cambian allá, cambian acá.
 * Cada `como` recibe los números de LA regla que disparó el evento, así la explicación dice
 * «avisa a los 15 min» y no «avisa cuando pasa un rato».
 *
 * Archivo puro: sin Prisma ni React, lo usan el navegador y el servidor.
 */
export type ClaveComportamiento =
    | "permanencia" | "merodeo" | "intrusion" | "cruce" | "sentido" | "aglomeracion" | "fila"
    | "animal" | "dejado" | "retirado" | "suelo" | "trepar" | "epp" | "conteo";

export type ParamsComportamiento = {
    segundos?: number | null; maximo?: number | null; horario?: { desde: string; hasta: string } | null;
    clase?: string | null;
};

type Def = {
    nombre: string;
    /** En una línea: qué tiene que pasar. */
    que: string;
    /** Cómo decide, paso a paso, con los números de la regla. */
    como: (p: ParamsComportamiento) => string[];
    tono: "aviso" | "mal" | "info";
};

const dur = (s: number | null | undefined, def: string) => {
    if (s == null || !Number.isFinite(s)) return def;
    if (s < 60) return `${Math.round(s)} s`;
    const m = Math.round(s / 60);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
};
const horario = (h: ParamsComportamiento["horario"]) => (h?.desde && h?.hasta ? ` Sólo de ${h.desde} a ${h.hasta}.` : "");

export const COMPORTAMIENTOS: Record<ClaveComportamiento, Def> = {
    permanencia: {
        nombre: "Se quedó en la zona", tono: "aviso",
        que: "Algo entra a la zona y se queda más tiempo del permitido.",
        como: (p) => [
            `Sigue el pie de cada vehículo o persona: cuando cae adentro de la zona, arranca su reloj.`,
            `Si sigue adentro ${dur(p.segundos, "el tiempo de la regla")}, avisa con la foto marcada. El reloj sigue corriendo en pantalla.`,
            `Si el detector lo pierde un rato y lo vuelve a ver en el mismo lugar, es el mismo: el reloj no vuelve a cero. Se da por ido al salir de la zona, o tras 10 min sin verlo.`,
        ],
    },
    merodeo: {
        nombre: "Merodeo", tono: "aviso",
        que: "Una persona camina por la zona un buen rato, sin quedarse quieta.",
        como: (p) => [
            `Junta el tiempo que la persona pasa en la zona y lo que camina (la suma de sus pasos).`,
            `Avisa si lleva ${dur(p.segundos, "el tiempo de la regla")} y además recorrió más de medio cuadro de lado a lado: el que espera parado no merodea.`,
            `Un aviso por persona; entre dos avisos de la misma regla pasan al menos 2 min.${horario(p.horario)}`,
        ],
    },
    intrusion: {
        nombre: "Entró a la zona", tono: "mal",
        que: "Alguien o algo entra donde no debe y se queda unos segundos.",
        como: (p) => [
            `Mira dónde pisa cada uno (el pie de la caja), no la caja entera: una sombra o una cabeza asomando no cuentan.`,
            `Si el pie queda adentro ${dur(p.segundos ?? 2, "2 s")} seguidos, avisa. Sabe QUÉ entró: persona, vehículo o animal.${horario(p.horario)}`,
        ],
    },
    cruce: {
        nombre: "Cruzó la línea", tono: "mal",
        que: "Pasa por encima de una línea: un cerco, un portón, un límite.",
        como: (p) => [
            `Une la posición del pie entre dos cuadros: si ese tramo corta la línea, cruzó.`,
            `El que tiembla sobre la línea no cruza dos veces (5 s de rebote). Un grupo que salta junto es un aviso, no cinco.${horario(p.horario)}`,
        ],
    },
    sentido: {
        nombre: "Va en contramano", tono: "mal",
        que: "Cruza la línea en el sentido que no corresponde.",
        como: () => [
            `La línea tiene un sentido permitido. Cada cruce se compara con él.`,
            `El cruce al revés queda registrado con su foto y avisa (como mucho uno por minuto por regla).`,
        ],
    },
    aglomeracion: {
        nombre: "Se juntaron varios", tono: "aviso",
        que: "Más personas juntas en la zona de las permitidas, durante un rato.",
        como: (p) => [
            `Cuenta las personas con el pie en la zona en cada cuadro.`,
            `Si son ${p.maximo ?? "las de la regla"} o más durante ${dur(p.segundos, "el tiempo de la regla")}, avisa con todas marcadas. La misma reunión no vuelve a avisar en 10 min.`,
        ],
    },
    fila: {
        nombre: "Fila", tono: "info",
        que: "Cuántos esperan en la zona, cuántos entran y salen.",
        como: (p) => [
            `El aforo son las personas con el pie en la zona; un número nuevo vale si se sostiene el rebote (unos segundos).`,
            `Entra quien cruza el borde hacia adentro y sale quien cruza hacia afuera; lo que aparece adentro no cuenta.`,
            `Al llegar a ${p.maximo ?? 10} personas avisa; si sigue llena, otro aviso para el supervisor.`,
        ],
    },
    animal: {
        nombre: "Animal suelto", tono: "aviso",
        que: "Un animal en la zona sin ninguna persona con él.",
        como: (p) => [
            `Busca perros, gatos, caballos y vacas con el pie en la zona, ${dur(p.segundos ?? 3, "3 s")} seguidos.`,
            `Si hay una persona en la zona, no avisa: el perro con su dueño no anda suelto. Si la persona se va y el animal sigue, avisa.${horario(p.horario)}`,
        ],
    },
    dejado: {
        nombre: "Objeto abandonado", tono: "mal",
        que: "Aparece un bulto y queda solo, sin nadie al lado.",
        como: (p) => [
            `Un bulto (mochila, valija, bolso) que no se mueve junta tiempo; el que alguien lleva en la mano se corre y empieza de cero.`,
            `Si queda ${dur(p.segundos, "el tiempo de la regla")} sin ninguna persona cerca (a una vez y media su tamaño), avisa.`,
        ],
    },
    retirado: {
        nombre: "Se llevaron algo", tono: "mal",
        que: "Algo que estaba quieto en la zona ya no está.",
        como: (p) => [
            `Primero aprende lo que hay: un objeto quieto 1 min en la zona queda «sabido».`,
            `Si falta ${dur(p.segundos, "el tiempo de la regla")} y en al menos 5 cuadros seguidos, avisa. Si una persona lo tapa, no cuenta como que se fue.`,
        ],
    },
    suelo: {
        nombre: "Persona en el suelo", tono: "mal",
        que: "Una persona acostada en la zona: se cayó o se descompuso.",
        como: (p) => [
            `Con una persona en la zona, mira su postura (hombros y caderas): acostada es el torso a más de 60° de la vertical.`,
            `Si sigue así ${dur(p.segundos, "el tiempo de la regla")}, avisa.`,
        ],
    },
    trepar: {
        nombre: "Trepando", tono: "mal",
        que: "Una persona junto al cerco con las manos arriba.",
        como: (p) => [
            `Con una persona en la zona del cerco, mira su pose: las dos muñecas bien por encima de los hombros.`,
            `Alguien que saluda con los brazos arriba también lo cumple: por eso pide estar sobre el cerco y sostenerlo.`,
            `Sostenido ${dur(p.segundos, "unos segundos")}, avisa.${horario(p.horario)}`,
        ],
    },
    epp: {
        nombre: "Sin casco o chaleco", tono: "aviso",
        que: "Alguien en la obra sin el equipo de seguridad.",
        como: (p) => [
            `A cada persona en la zona le busca el casco y el chaleco, en varios cuadros: una sola lectura no alcanza (de espaldas o lejos se equivoca).`,
            `Con al menos 3 lecturas y 6 de cada 10 diciendo que falta, tras ${dur(p.segundos, "el tiempo de la regla")} en la zona, avisa qué le falta.`,
        ],
    },
    conteo: {
        nombre: "Conteo", tono: "info",
        que: "Suma los que cruzan la línea, por sentido, clase y hora.",
        como: () => [`Cada cruce de la línea suma en su sentido. No avisa: es para los gráficos y los reportes.`],
    },
};

/** El tipo de EventoVision (PERMANENCIA, MERODEO…) o del aviso (VISION_*) a su comportamiento. */
const POR_EVENTO: Record<string, ClaveComportamiento> = {
    PERMANENCIA: "permanencia", MERODEO: "merodeo", INTRUSION: "intrusion", CRUCE_LINEA: "cruce", CRUCE: "conteo",
    SENTIDO_CONTRARIO: "sentido", AGLOMERACION: "aglomeracion", FILA: "fila", FILA_LLENA: "fila", FILA_ESCALADA: "fila",
    ANIMAL: "animal", DEJADO: "dejado", RETIRADO: "retirado", SUELO: "suelo", TREPA: "trepar", EPP: "epp",
    VISION_PERMANENCIA: "permanencia", VISION_MERODEO: "merodeo", VISION_INTRUSION: "intrusion", VISION_CRUCE: "cruce",
    VISION_SENTIDO: "sentido", VISION_AGLOMERACION: "aglomeracion", VISION_FILA: "fila", VISION_ANIMAL: "animal",
    VISION_DEJADO: "dejado", VISION_RETIRADO: "retirado", VISION_SUELO: "suelo", VISION_TREPA: "trepar", VISION_EPP: "epp",
};
export function comportamientoDe(tipo: string | null | undefined, reglaTipo?: string | null): ClaveComportamiento | null {
    if (reglaTipo && reglaTipo in COMPORTAMIENTOS) return reglaTipo as ClaveComportamiento;
    return (tipo && POR_EVENTO[tipo]) || null;
}

