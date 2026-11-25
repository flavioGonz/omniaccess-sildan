/**
 * La tapa de los informes en PDF, una sola para todos (25/11).
 *
 * Nico, sobre el informe de Procesamiento LPR: «poner la portada con los logos de OmniVision;
 * intentemos que todos los reportes salgan similares en diseño». Hasta acá cada informe dibujaba la
 * suya: el de rastreo tenía la tapa oscura a sangre (23/11) y el de lecturas una banda con arcos y
 * una ficha blanca abajo. Dos informes del mismo producto que no parecían de la misma familia.
 *
 * Ahora la tapa se arma acá y cada informe le pasa lo suyo: qué producto lo firma (OmniAccess u
 * OmniVision), de qué es, de cuándo, qué trae adentro y sus cifras. Lo que no cambia entre informes
 * —la tapa oscura, la marca arriba a la izquierda, el logo del cliente a la derecha, el filo de luz,
 * el recuadro de detección enorme y apenas visible, el pie con quién y cuándo— vive una sola vez.
 *
 * Sirve para A4 vertical y apaisado: las medidas salen de la hoja.
 *
 * El filo de arriba es del color del producto: el azul de acción para OmniAccess y el violeta de
 * OmniVision (#8A6CFF, el punto del isotipo; ver claude/marca-omniaccess.md) para lo que firma
 * OmniVision. Es el único lugar donde ese violeta pinta algo más que el punto, y es en la tapa,
 * donde dice quién mira.
 */
import type { jsPDF } from "jspdf";
import { COLOR, rgb, isotipoPng, type Marca } from "@/lib/informes/marca";
import { EN_TAPA } from "@/lib/informes/paleta";

export const VIOLETA_OMNIVISION = "#8A6CFF";

export type Tapa = {
    producto: "OMNIACCESS" | "OMNIVISION";
    /** El rótulo debajo del nombre del producto: «Rastreo satelital», «Procesamiento LPR». */
    linea: string;
    /** Lo que es el informe, chico, arriba del título. */
    rotulo: string;
    /** De quién o de qué: el título grande. Se achica antes que partirse en tres renglones. */
    titulo: string;
    debajo?: string | null;
    periodo: string;
    /** Qué trae adentro, con su cantidad (la columna de la derecha). */
    contenido?: { titulo: string; valor: string; apagado?: boolean }[];
    /** Las cifras del período, en una fila al pie de la tapa. Sobre el fondo oscuro los tonos van claros (EN_TAPA). */
    cifras: { v: string; que: string; tono?: string }[];
    /** Con qué vara se midió, o lo que haga falta aclarar (pie izquierdo). */
    pie?: string;
    emitido: string;
    por: string;
    marca: Marca;
};

export async function dibujarTapa(doc: jsPDF, t: Tapa): Promise<void> {
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    const apaisada = W > H;
    const MT = 18;
    const color = (hex: string, que: "texto" | "relleno" | "linea" = "texto") => {
        const [a, b, c] = rgb(hex);
        if (que === "texto") doc.setTextColor(a, b, c); else if (que === "relleno") doc.setFillColor(a, b, c); else doc.setDrawColor(a, b, c);
    };
    const texto = (s: string, x: number, y: number, o: { tam?: number; negrita?: boolean; col?: string; alinear?: "left" | "right"; espaciado?: number; ancho?: number } = {}) => {
        doc.setFont("Outfit", o.negrita ? "bold" : "normal"); doc.setFontSize(o.tam || 9); color(o.col || EN_TAPA.texto);
        const lineas: string[] = o.ancho ? doc.splitTextToSize(s, o.ancho) : [s];
        doc.text(lineas, x, y, { align: o.alinear || "left", charSpace: o.espaciado || 0, lineHeightFactor: 1.35 });
        return lineas.length;
    };
    const rotulo = (s: string, x: number, y: number, col: string = EN_TAPA.apagado) => texto(s.toUpperCase(), x, y, { tam: 6.6, negrita: true, col, espaciado: 0.4 });
    const conOpacidad = (o: number, dibujar: () => void) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GState no está en los tipos de jsPDF
        const G = (doc as any).GState; doc.setGState(new G({ opacity: o, "stroke-opacity": o })); dibujar(); doc.setGState(new G({ opacity: 1, "stroke-opacity": 1 }));
    };
    const filo = t.producto === "OMNIVISION" ? VIOLETA_OMNIVISION : COLOR.accion;
    const iso = await isotipoPng("#ffffff", 1024);

    /* El fondo, a sangre, y el recuadro de detección enorme saliéndose por la derecha. */
    color(t.marca.primario, "relleno"); doc.rect(0, 0, W, H, "F");
    if (iso) conOpacidad(0.04, () => doc.addImage(iso, "PNG", W - (apaisada ? 150 : 128), apaisada ? -34 : -20, apaisada ? 236 : 210, apaisada ? 236 : 210));
    color(filo, "relleno"); doc.rect(0, 0, W, 1.6, "F");

    /* ── La marca: el producto a la izquierda, el cliente a la derecha ── */
    if (iso) doc.addImage(iso, "PNG", MT, 15, 13, 13);
    const xMarca = MT + (iso ? 17 : 0);
    texto(t.producto, xMarca, 21.2, { tam: 13.5, negrita: true, espaciado: 0.9 });
    rotulo(t.linea, xMarca, 26.2);
    /* El ancho lo mide jsPDF sin el espaciado entre letras: se suma a mano, si no «de OmniAccess» se monta encima. */
    if (t.producto === "OMNIVISION") rotulo("de OmniAccess", xMarca + doc.getTextWidth(t.linea.toUpperCase()) + t.linea.length * 0.4 + 3, 26.2, EN_TAPA.mudo);
    if (t.marca.logo) {
        const alto = 11, ancho = Math.min(alto * (t.marca.logo.w / t.marca.logo.h), 62);
        doc.addImage(t.marca.logo.png, "PNG", W - MT - ancho, 16, ancho, alto);
    } else if (t.marca.empresa && t.marca.empresa !== "OmniAccess") texto(t.marca.empresa, W - MT, 22.5, { tam: 11, negrita: true, col: EN_TAPA.claro, alinear: "right" });

    /* ── De qué y de cuándo ── */
    const yTitulo = apaisada ? 76 : 92;
    const anchoTitulo = apaisada ? 168 : W - MT * 2;
    rotulo(t.rotulo, MT, yTitulo, filo === COLOR.accion ? COLOR.accionClaro : "#b9a8ff");
    let tam = apaisada ? 40 : 34; doc.setFont("Outfit", "bold");
    for (; tam > 22; tam -= 2) { doc.setFontSize(tam); if (doc.splitTextToSize(t.titulo, anchoTitulo).length <= (apaisada ? 1 : 2)) break; }
    const renglones = Math.min(apaisada ? 2 : 3, texto(t.titulo, MT, yTitulo + tam * 0.44 + 3, { tam, negrita: true, ancho: anchoTitulo }));
    let yT = yTitulo + tam * 0.44 + 3 + (renglones - 1) * tam * 0.476 + 9;
    if (t.debajo) yT += texto(t.debajo, MT, yT, { tam: 11, col: EN_TAPA.apagado, ancho: anchoTitulo }) * 5.2 + 2.5;
    color(filo, "relleno"); doc.rect(MT, yT - 1.5, 22, 1.1, "F");
    texto(t.periodo, MT, yT + 8, { tam: 13, negrita: true, ancho: anchoTitulo });

    /* ── Qué trae adentro ── */
    if (t.contenido?.length) {
        const xC = apaisada ? 206 : MT, anchoC = apaisada ? W - MT - xC : W - MT * 2;
        const yC = apaisada ? 76 : yT + 26;
        rotulo("En este informe", xC, yC);
        t.contenido.forEach((x, k) => {
            const y = yC + 8.5 + k * 6.7;
            conOpacidad(0.12, () => { color("#ffffff", "linea"); doc.setLineWidth(0.2); doc.line(xC, y - 4.3, xC + anchoC, y - 4.3); });
            texto(x.titulo, xC, y, { tam: 9, col: x.apagado ? EN_TAPA.mudo : EN_TAPA.claro });
            texto(x.valor, xC + anchoC, y, { tam: 9, negrita: !x.apagado, col: x.apagado ? EN_TAPA.mudo : EN_TAPA.texto, alinear: "right" });
        });
    }

    /* ── Las cifras del período ── */
    if (t.cifras.length) {
        const yK = H - (apaisada ? 50 : 56), cw = (W - MT * 2) / t.cifras.length;
        conOpacidad(0.16, () => { color("#ffffff", "linea"); doc.setLineWidth(0.25); doc.line(MT, yK - 13, W - MT, yK - 13); });
        const tamCifra = t.cifras.length > 5 ? 17 : 20;
        t.cifras.forEach((c, k) => {
            const x = MT + k * cw;
            texto(c.v, x, yK, { tam: tamCifra, negrita: true, col: c.tono || EN_TAPA.texto });
            texto(c.que, x, yK + 5.6, { tam: 8.2, col: EN_TAPA.apagado, ancho: cw - 4 });
        });
    }

    /* ── El pie: con qué vara se midió, y quién y cuándo lo emitió ── */
    conOpacidad(0.16, () => { color("#ffffff", "linea"); doc.setLineWidth(0.25); doc.line(MT, H - 23, W - MT, H - 23); });
    if (t.pie) texto(t.pie, MT, H - 15.5, { tam: 8.2, col: EN_TAPA.apagado, ancho: apaisada ? 170 : 110 });
    texto(`Emitido el ${t.emitido}`, W - MT, H - 15.5, { tam: 8.2, col: EN_TAPA.claro, alinear: "right" });
    texto(`por ${t.marca.preparadoPor || t.por}`, W - MT, H - 11.2, { tam: 8.2, col: EN_TAPA.apagado, alinear: "right" });
}
