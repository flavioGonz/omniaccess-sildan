/**
 * Vocabulario abierto (OWLv2 en omni-vision): qué se le manda al modelo cuando se escribe en
 * castellano.
 *
 * OWLv2 aprendió de textos en inglés. En castellano entiende algo, pero peor (medido el 17/10 con
 * la foto de prueba: «a dog» 0,65 · «un perro» 0,51; «a backpack» 0,66 · «una mochila» 0,35).
 * Por eso lo que está en este glosario se manda en inglés, y lo que no está se manda tal cual
 * (se puede escribir directamente en inglés). La pantalla muestra cómo se buscó.
 *
 * El glosario es de lo que tiene sentido en un barrio: obra, basura, jardín, calle, seguridad.
 * Sin artículos ni plurales: se normaliza antes de buscar.
 */
const GLOSARIO: Record<string, string> = {
    carretilla: "wheelbarrow", escalera: "ladder", "bolsa de basura": "garbage bag", bolsa: "bag", basura: "trash",
    contenedor: "dumpster", "contenedor de basura": "dumpster", tacho: "trash can", "tacho de basura": "trash can", papelera: "trash can",
    cono: "traffic cone", "cono vehicular": "traffic cone", vallado: "barrier fence", valla: "fence", barrera: "barrier", cerco: "fence", reja: "fence",
    casco: "helmet", chaleco: "safety vest", "chaleco reflectivo": "high visibility vest", uniforme: "uniform",
    pala: "shovel", rastrillo: "rake", manguera: "garden hose", cortadora: "lawn mower", "cortadora de pasto": "lawn mower", bordeadora: "string trimmer",
    taladro: "drill", martillo: "hammer", herramienta: "tool", "caja de herramientas": "toolbox", andamio: "scaffolding",
    ladrillo: "brick", ladrillos: "bricks", arena: "sand pile", hormigonera: "concrete mixer", mezcladora: "concrete mixer",
    tabla: "wooden plank", madera: "wood", tablones: "wooden planks", caño: "pipe", tubo: "pipe",
    caja: "box", "caja de cartón": "cardboard box", paquete: "package", sobre: "envelope",
    bicicleta: "bicycle", moto: "motorcycle", monopatín: "scooter", "monopatín eléctrico": "electric scooter", patineta: "skateboard",
    camioneta: "pickup truck", camión: "truck", furgoneta: "van", acoplado: "trailer", remolque: "trailer", tractor: "tractor", grúa: "crane",
    "carro de supermercado": "shopping cart", carrito: "cart", cochecito: "stroller", "silla de ruedas": "wheelchair",
    perro: "dog", gato: "cat", caballo: "horse", vaca: "cow", pájaro: "bird",
    fuego: "fire", humo: "smoke", llamas: "flames", charco: "puddle", agua: "water",
    árbol: "tree", "rama caída": "fallen branch", rama: "tree branch", pasto: "grass", "pasto alto": "tall grass",
    mochila: "backpack", cartera: "handbag", valija: "suitcase", maleta: "suitcase", paraguas: "umbrella",
    celular: "cell phone", teléfono: "phone", cámara: "camera", linterna: "flashlight",
    arma: "gun", pistola: "pistol", cuchillo: "knife", palo: "stick", bate: "baseball bat",
    persona: "person", hombre: "man", mujer: "woman", niño: "child", "persona en el suelo": "person lying on the ground",
    pelota: "ball", "pelota de fútbol": "soccer ball", arco: "soccer goal",
    puerta: "door", portón: "gate", ventana: "window", buzón: "mailbox", farol: "street lamp", poste: "pole", cartel: "sign",
    "tapa de alcantarilla": "manhole cover", pozo: "hole", bache: "pothole",
};

const ARTICULO = /^(el|la|los|las|un|una|unos|unas)\s+/;

export function normalizarConsulta(s: string): string {
    return s.trim().toLowerCase().replace(/\s+/g, " ").replace(ARTICULO, "");
}

/** Lo que se le manda al modelo por cada frase escrita: en inglés si está en el glosario. */
export function traducirConsulta(s: string): { escrita: string; enviada: string; traducida: boolean } {
    const n = normalizarConsulta(s);
    const sing = n.replace(/(es|s)$/, "");
    const en = GLOSARIO[n] || GLOSARIO[sing] || null;
    return { escrita: s.trim(), enviada: en || n, traducida: !!en };
}

/** Separa lo escrito en frases: por comas o punto y coma. Hasta 8, como acepta omni-vision. */
export function consultasDe(texto: string): string[] {
    return texto.split(/[,;]/).map((x) => x.trim()).filter(Boolean).slice(0, 8);
}

/** Sugerencias para el campo, de lo que tiene sentido en un barrio. */
export const SUGERENCIAS_VOCABULARIO = ["carretilla", "escalera", "bolsa de basura", "contenedor", "cono", "casco", "andamio", "humo"];
