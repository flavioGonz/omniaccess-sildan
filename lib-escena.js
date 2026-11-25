/**
 * La foto de escena de una lectura de matrícula, achicada antes de guardarla (25/11).
 *
 * Nico eligió las dos cosas para que el disco no se llene: retención de 30 días y fotos más chicas.
 * Medido el 25/11 en el bucket de LPR: las fotos de escena de las cámaras (`hik_…`) son de 2560×1632 y
 * pesan 1,55 MB de promedio; eran el 86 % del bucket (148 de 172 GB). A 1920 de ancho y calidad 75
 * (mozjpeg) quedan en 441 KB —un 72 % menos— y se siguen leyendo la chapa, el vehículo y su color.
 * El recorte de la chapa (`plate_…`) se guarda aparte y no se toca: es el que hay que poder ampliar.
 *
 * Si algo falla (una imagen rara, sharp que no carga) se guarda la original: perder la foto de una
 * lectura por querer ahorrar espacio sería peor que guardarla grande.
 */
const ANCHO = Number(process.env.ESCENA_ANCHO || 1920);
const CALIDAD = Number(process.env.ESCENA_CALIDAD || 75);
let sharp = null;
try { sharp = require("sharp"); } catch { /* sin sharp, se guarda tal cual */ }

/** @param {Buffer} buf @returns {Promise<Buffer>} */
async function achicarEscena(buf) {
    if (!sharp || !buf || buf.length < 200_000) return buf;   // ya es chica: no se recomprime
    try {
        const sale = await sharp(buf, { failOn: "none" }).rotate().resize({ width: ANCHO, withoutEnlargement: true }).jpeg({ quality: CALIDAD, mozjpeg: true }).toBuffer();
        return sale.length < buf.length ? sale : buf;
    } catch { return buf; }
}

module.exports = { achicarEscena };
