/**
 * El formato de una matrícula del Mercosur, y la corrección de lo que el OCR confunde.
 *
 * Por qué (15/10, pedido de Nico: «deben ser del Mercosur para nuestras detecciones»): nuestros
 * lectores (la relectura de OmniVision, omni-lpr, el seguimiento) aceptaban cualquier texto de
 * 6 a 8 caracteres con letras y números. Medido en San Nicolás, 7 días: 160 de 728 relecturas
 * (22 %) no tenían forma de chapa — `94C044`, `9P88688`, `KCX1AW9` —, casi todas DUDOSA.
 *
 * Qué se acepta, y por qué cada uno:
 *   UY / BR viejo   AAA1234   el particular uruguayo (y el brasileño previo al Mercosur)
 *   BR Mercosur     AAA1A23
 *   AR Mercosur     AA123AA
 *   PY Mercosur     AAAA123
 *   UY moto / AR    AAA123    las motos del barrio (SPA229) y el auto argentino viejo
 *   UY vieja        A123456   chapas uruguayas anteriores al Mercosur que SIGUEN circulando:
 *                             B590612 pasó 29 veces por las cámaras de San Nicolás en 7 días.
 *                             Un filtro Mercosur estricto las habría tirado.
 *
 * La corrección: sabiendo dónde va una letra y dónde un número, lo que el OCR confunde se
 * arregla por posición — `SB0I234` es SBO1234 —. Se corrige como mucho CORRECCIONES_MAX
 * caracteres: más que eso ya no es leer mal, es leer otra cosa.
 *
 * Hay una copia en TypeScript para el panel (src/lib/formato-chapa.ts). Si cambia una, cambiar
 * la otra: son dos procesos y no comparten módulos.
 */

/**
 * `max`: cuántos caracteres se le pueden corregir. Las uruguayas, hasta CORRECCIONES_MAX; las
 * extranjeras, una sola: son raras en el barrio, y con dos cambios cualquier ruido de siete
 * caracteres termina pareciendo una chapa argentina (SCI781P → SC178IP).
 */
const CORRECCIONES_MAX = 2;
const FORMATOS = [
    { id: "UY", molde: "LLLNNNN", max: CORRECCIONES_MAX },
    { id: "BR", molde: "LLLNLNN", max: 1 },
    { id: "AR", molde: "LLNNNLL", max: 1 },
    { id: "PY", molde: "LLLLNNN", max: 1 },
    { id: "UY_MOTO", molde: "LLLNNN", max: CORRECCIONES_MAX },
    { id: "UY_VIEJA", molde: "LNNNNNN", max: CORRECCIONES_MAX },
];
/** Lo que el OCR confunde, en las dos direcciones. Sólo pares que se parecen de verdad. */
const A_NUMERO = { O: "0", Q: "0", D: "0", I: "1", L: "1", B: "8", S: "5", Z: "2", G: "6" };
const A_LETRA = { "0": "O", "1": "I", "8": "B", "5": "S", "2": "Z", "6": "G" };

const limpiar = (t) => String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const esLetra = (c) => c >= "A" && c <= "Z";
const esNumero = (c) => c >= "0" && c <= "9";

/** Aplica un molde: la chapa corregida y cuántos caracteres hubo que cambiar, o null si no entra. */
function enMolde(s, molde, max = CORRECCIONES_MAX) {
    if (s.length !== molde.length) return null;
    let out = "", cambios = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i], quiere = molde[i];
        if (quiere === "L") {
            if (esLetra(c)) out += c;
            else if (A_LETRA[c]) { out += A_LETRA[c]; cambios++; }
            else return null;
        } else {
            if (esNumero(c)) out += c;
            else if (A_NUMERO[c]) { out += A_NUMERO[c]; cambios++; }
            else return null;
        }
    }
    return cambios > max ? null : { plate: out, cambios };
}

/**
 * La matrícula normalizada: `{ plate, formato, cambios }`, o null si no tiene forma de chapa.
 * Entre dos moldes posibles gana el que pide menos cambios; a igualdad, el primero de la lista.
 */
function normalizarChapa(texto) {
    const s = limpiar(texto);
    let mejor = null;
    for (const f of FORMATOS) {
        const r = enMolde(s, f.molde, f.max);
        if (r && (!mejor || r.cambios < mejor.cambios)) mejor = { plate: r.plate, formato: f.id, cambios: r.cambios };
        if (mejor && mejor.cambios === 0) break;
    }
    return mejor;
}

/** El formato tal como se leyó, sin corregir nada (para marcar lo que manda la cámara). */
function formatoDe(texto) {
    const s = limpiar(texto);
    for (const f of FORMATOS) { const r = enMolde(s, f.molde); if (r && r.cambios === 0) return f.id; }
    return null;
}

module.exports = { normalizarChapa, formatoDe, FORMATOS, CORRECCIONES_MAX };
