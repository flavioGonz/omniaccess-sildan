/**
 * Los reportes de rastreo en PDF (A4 apaisado): una tapa con la marca, de quién es, de cuándo y las
 * cifras del período; y después cada reporte, como una tabla.
 *
 * Apaisado porque son tablas anchas —un viaje tiene doce columnas— y en vertical habría que
 * achicar la letra hasta que no se lea o partir cada renglón en dos.
 *
 * Lo mismo que el informe de lecturas, para que no se discuta de nuevo: color sólo donde dice algo;
 * nada de sombras ni degradés, que en papel se ven sucios; y el PDF tiene tope de filas por tabla —
 * más que eso es un listado, no un informe, y está entero en el Excel. Cuando se corta, se dice.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { COLOR, rgb, fuentesOutfit, isotipoPng, type Marca } from "@/lib/informes/marca";
import { duracionDeReporte, esNumero, textoDeCelda, type TablaReporte } from "@/lib/gps-reportes-catalogo";
import { periodoEnPalabras, vehiculosEnPalabras, type ReporteGps } from "@/lib/gps-reportes-servidor";

const W = 297, H = 210, M = 12;
/** Filas por tabla en el PDF. */
export const PDF_FILAS_MAX = 400;

export async function reporteGpsPdf(r: ReporteGps, marca: Marca, generadoPor: string): Promise<Buffer> {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
    const f = await fuentesOutfit();
    doc.addFileToVFS("Outfit-Regular.ttf", f.regular); doc.addFont("Outfit-Regular.ttf", "Outfit", "normal");
    doc.addFileToVFS("Outfit-Bold.ttf", f.negrita); doc.addFont("Outfit-Bold.ttf", "Outfit", "bold");
    doc.setFont("Outfit", "normal");
    doc.setProperties({ title: "Reporte de rastreo", subject: periodoEnPalabras(r), author: marca.empresa, creator: "OmniAccess" });

    const color = (hex: string, que: "texto" | "relleno" | "linea" = "texto") => {
        const [a, b, c] = rgb(hex);
        if (que === "texto") doc.setTextColor(a, b, c); else if (que === "relleno") doc.setFillColor(a, b, c); else doc.setDrawColor(a, b, c);
    };
    const texto = (t: string, x: number, y: number, o: { tam?: number; negrita?: boolean; col?: string; alinear?: "left" | "right"; espaciado?: number; ancho?: number } = {}) => {
        doc.setFont("Outfit", o.negrita ? "bold" : "normal"); doc.setFontSize(o.tam || 9); color(o.col || COLOR.texto);
        const lineas: string[] = o.ancho ? doc.splitTextToSize(t, o.ancho) : [t];
        doc.text(lineas, x, y, { align: o.alinear || "left", charSpace: o.espaciado || 0, lineHeightFactor: 1.35 });
        return lineas.length;
    };
    const rotulo = (t: string, x: number, y: number, col: string = COLOR.gris) => texto(t.toUpperCase(), x, y, { tam: 6.6, negrita: true, col, espaciado: 0.4 });

    const conOpacidad = (o: number, dibujar: () => void) => {
        /* Las dos: `opacity` vale para los rellenos y las imágenes; las líneas llevan la suya. Con una sola, las rayas de la tapa salían blancas plenas. */
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GState no está en los tipos de jsPDF
        const G = (doc as any).GState; doc.setGState(new G({ opacity: o, "stroke-opacity": o })); dibujar(); doc.setGState(new G({ opacity: 1, "stroke-opacity": 1 }));
    };
    const [isoClaro, isoTinta] = await Promise.all([isotipoPng("#ffffff", 1024), isotipoPng(COLOR.tinta, 256)]);
    const deQuien = r.vehiculos.length === 1 ? r.vehiculos[0].nombre : `Flota · ${r.vehiculos.length} vehículos`;
    const emitido = new Intl.DateTimeFormat("es-UY", { timeZone: r.zona, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(r.generado)).replace(",", "");
    const enPdf = r.tablas.filter((x) => x.clave !== "posiciones");

    /* ══ LA TAPA ══
       Nico (23/11): «la primera página debe ser estilizada premium, con el logo de OmniAccess».
       Antes el reporte arrancaba con una banda y, pegadas debajo, las tablas: se leía como una
       planilla impresa. Ahora la primera hoja es una tapa —de quién es, de cuándo, las cifras del
       período y qué trae adentro— y las tablas empiezan en la hoja siguiente.

       Es oscura y a sangre porque es UNA hoja, y es la que se ve al abrir el archivo o al dejarlo
       sobre un escritorio. Las hojas de adentro siguen blancas: ahí se lee, y un fondo gasta tinta
       y no deja escribir encima. */
    {
        const MT = 18;                                           // la tapa respira más que las hojas de datos
        color(marca.primario, "relleno"); doc.rect(0, 0, W, H, "F");
        /* El recuadro de detección de la marca, enorme y apenas visible, saliéndose por la derecha:
           dice de quién es la hoja sin competir con el título. */
        if (isoClaro) conOpacidad(0.04, () => doc.addImage(isoClaro, "PNG", W - 150, -34, 236, 236));
        /* Un filo de luz arriba: el único azul de la hoja. */
        color(COLOR.accion, "relleno"); doc.rect(0, 0, W, 1.6, "F");

        /* ── La marca: OmniAccess a la izquierda, quien recibe el reporte a la derecha ── */
        if (isoClaro) doc.addImage(isoClaro, "PNG", MT, 15, 13, 13);
        const xMarca = MT + (isoClaro ? 17 : 0);
        texto("OMNIACCESS", xMarca, 21.2, { tam: 13.5, negrita: true, col: "#ffffff", espaciado: 0.9 });
        rotulo("Rastreo satelital", xMarca, 26.2, "#94a3b8");
        if (marca.logo) {
            const alto = 11, ancho = Math.min(alto * (marca.logo.w / marca.logo.h), 62);
            doc.addImage(marca.logo.png, "PNG", W - MT - ancho, 16, ancho, alto);
        } else if (marca.empresa && marca.empresa !== "OmniAccess") texto(marca.empresa, W - MT, 22.5, { tam: 11, negrita: true, col: "#e2e8f0", alinear: "right" });

        /* ── De quién y de cuándo ── */
        const anchoTitulo = 168;
        rotulo("Reporte de rastreo", MT, 76, COLOR.accionClaro);
        /* El nombre de un vehículo puede ser largo: se achica antes que partirse en tres renglones. */
        let tam = 40; doc.setFont("Outfit", "bold");
        for (; tam > 24; tam -= 2) { doc.setFontSize(tam); if (doc.splitTextToSize(deQuien, anchoTitulo).length <= 1) break; }
        const renglones = Math.min(2, texto(deQuien, MT, 76 + tam * 0.44 + 3, { tam, negrita: true, col: "#ffffff", ancho: anchoTitulo }));
        let yT = 76 + tam * 0.44 + 3 + (renglones - 1) * tam * 0.476 + 9;
        const chapa = r.vehiculos.length === 1 ? r.vehiculos[0].matricula : null;
        const debajo = chapa ? `Matrícula ${chapa}` : r.vehiculos.length > 1 ? vehiculosEnPalabras(r) : null;
        if (debajo) yT += texto(debajo, MT, yT, { tam: 11, col: "#94a3b8", ancho: anchoTitulo }) * 5.2 + 2.5;
        color(COLOR.accion, "relleno"); doc.rect(MT, yT - 1.5, 22, 1.1, "F");
        texto(periodoEnPalabras(r), MT, yT + 8, { tam: 13, negrita: true, col: "#ffffff", ancho: anchoTitulo });

        /* ── Qué trae adentro: cada reporte con su cantidad de filas ── */
        const xC = 206, anchoC = W - MT - xC;
        rotulo("En este reporte", xC, 76, "#94a3b8");
        enPdf.forEach((x, k) => {
            const y = 84.5 + k * 6.7;
            conOpacidad(0.12, () => { color("#ffffff", "linea"); doc.setLineWidth(0.2); doc.line(xC, y - 4.3, xC + anchoC, y - 4.3); });
            texto(x.titulo, xC, y, { tam: 9, col: x.filasTotales ? "#e2e8f0" : "#64748b" });
            texto(x.filasTotales ? x.filasTotales.toLocaleString("es-UY") : "—", xC + anchoC, y, { tam: 9, negrita: !!x.filasTotales, col: x.filasTotales ? "#ffffff" : "#64748b", alinear: "right" });
        });

        /* ── Las cifras del período ── */
        const t = r.totales;
        const cifras: [string, string, string?][] = [
            [t.km.toFixed(1).replace(".", ",") + " km", "recorridos"], [String(t.viajes), t.viajes === 1 ? "viaje" : "viajes"], [duracionDeReporte(t.andandoMin), "andando"],
            [t.ralentiMin === null ? "—" : duracionDeReporte(t.ralentiMin), "en ralentí"], [t.velMax ? `${t.velMax} km/h` : "—", "velocidad máxima"],
            /* Sobre el fondo oscuro los tonos de estado van en su versión clara: el rojo y el ámbar de papel se apagan. */
            [String(t.excesos), t.excesos === 1 ? "exceso de velocidad" : "excesos de velocidad", t.excesos ? "#ff6b84" : undefined], [String(t.alarmas), t.alarmas === 1 ? "alarma" : "alarmas", t.alarmas ? "#f5b544" : undefined],
        ];
        const yK = 160, cw = (W - MT * 2) / cifras.length;
        conOpacidad(0.16, () => { color("#ffffff", "linea"); doc.setLineWidth(0.25); doc.line(MT, yK - 13, W - MT, yK - 13); });
        cifras.forEach(([v, que, tono], k) => {
            const x = MT + k * cw;
            texto(v, x, yK, { tam: 17, negrita: true, col: tono || "#ffffff" });
            texto(que, x, yK + 5.6, { tam: 8.2, col: "#94a3b8" });
        });

        /* ── El pie de la tapa: con qué vara se midió, y quién y cuándo lo emitió ── */
        conOpacidad(0.16, () => { color("#ffffff", "linea"); doc.setLineWidth(0.25); doc.line(MT, H - 23, W - MT, H - 23); });
        const vara = [`Velocidad permitida: ${r.limite} km/h`, r.horarioRotulo ? `Horario laboral: ${r.horarioRotulo}` : null, r.recortado ? "El período pedido era más largo que un mes: se recortó desde su comienzo" : null].filter(Boolean).join("   ·   ");
        texto(vara, MT, H - 15.5, { tam: 8.2, col: "#94a3b8", ancho: 170 });
        texto(`Emitido el ${emitido}`, W - MT, H - 15.5, { tam: 8.2, col: "#e2e8f0", alinear: "right" });
        texto(`por ${marca.preparadoPor || generadoPor}`, W - MT, H - 11.2, { tam: 8.2, col: "#94a3b8", alinear: "right" });
    }

    /* Las tablas empiezan en una hoja limpia. */
    doc.addPage();
    let y = 24;

    /* ── Cada reporte ── */
    const tabla = (x: TablaReporte) => {
        if (y > H - 46) { doc.addPage(); y = 24; }
        texto(x.titulo, M, y, { tam: 12.5, negrita: true, col: COLOR.tinta });
        const cuantas = x.filasTotales > PDF_FILAS_MAX ? `Las primeras ${PDF_FILAS_MAX} de ${x.filasTotales.toLocaleString("es-UY")} filas: completo en el Excel.` : x.filasTotales ? `${x.filasTotales.toLocaleString("es-UY")} ${x.filasTotales === 1 ? "fila" : "filas"}` : "";
        if (cuantas) texto(cuantas, W - M, y, { tam: 7.5, col: x.filasTotales > PDF_FILAS_MAX ? COLOR.avisoTexto : COLOR.grisClaro, alinear: "right" });
        y += 4.4;
        y += texto(x.nota || x.ayuda, M, y, { tam: 7.8, col: COLOR.gris, ancho: W - M * 2 }) * 3.6;
        if (!x.filas.length) {
            color(COLOR.superficie, "relleno"); doc.roundedRect(M, y, W - M * 2, 10, 1.5, 1.5, "F");
            texto(x.vacio, M + 4, y + 6.2, { tam: 8.5, col: COLOR.gris });
            y += 18;
            return;
        }
        const numeros = x.columnas.map((c) => esNumero(c.formato));
        const peso = x.columnas.reduce((a, c) => a + c.ancho, 0);
        autoTable(doc, {
            startY: y + 1, margin: { left: M, right: M, top: 20, bottom: 16 },
            head: [x.columnas.map((c) => c.rotulo)],
            body: x.filas.slice(0, PDF_FILAS_MAX).map((fila) => x.columnas.map((c, i) => textoDeCelda(c.formato, fila[i]))),
            foot: x.total ? [x.columnas.map((c, i) => textoDeCelda(c.formato, x.total![i], ""))] : undefined,
            showFoot: "lastPage",
            styles: { font: "Outfit", fontSize: 7.6, cellPadding: { top: 1.7, bottom: 1.7, left: 2, right: 2 }, textColor: rgb(COLOR.texto), lineWidth: 0, overflow: "linebreak" },
            headStyles: { font: "Outfit", fontStyle: "bold", fillColor: rgb(COLOR.tinta), textColor: [255, 255, 255], fontSize: 7.2 },
            footStyles: { font: "Outfit", fontStyle: "bold", fillColor: rgb(COLOR.superficie), textColor: rgb(COLOR.tinta), fontSize: 7.6 },
            alternateRowStyles: { fillColor: rgb("#f7f8fa") },
            /* Los anchos salen de los de la planilla, en proporción: una sola idea de qué columna es ancha. */
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- los tipos de autotable no admiten un mapa armado así
            columnStyles: Object.fromEntries(x.columnas.map((c, i) => [i, { cellWidth: ((W - M * 2) * c.ancho) / peso, halign: numeros[i] ? "right" : "left" }])) as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            didParseCell: (d: any) => {
                if (numeros[d.column.index]) d.cell.styles.halign = "right";
                /* Lo único que lleva color: cuánto se pasó del límite. */
                if (d.section === "body" && x.clave === "excesos" && x.columnas[d.column.index].rotulo === "Sobre el límite") { d.cell.styles.textColor = rgb(COLOR.mal); d.cell.styles.fontStyle = "bold"; }
                if (d.section === "body" && d.cell.raw === "Fuera de horario") { d.cell.styles.textColor = rgb(COLOR.avisoTexto); d.cell.styles.fontStyle = "bold"; }
            },
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        y = (doc as any).lastAutoTable.finalY + 11;
    };
    enPdf.forEach(tabla);
    if (r.tablas.some((x) => x.clave === "posiciones")) {
        if (y > H - 26) { doc.addPage(); y = 24; }
        texto("El detalle de posiciones no va en el PDF: es un listado de miles de renglones. Está en el Excel.", M, y, { tam: 8.5, col: COLOR.gris });
    }

    /* ── La cabecera y el pie de cada hoja de adentro ──
       La tapa tiene los suyos. Adentro, cada hoja dice de quién es: una hoja suelta en una carpeta
       tiene que poder leerse sin la tapa. */
    const paginas = doc.getNumberOfPages();
    for (let i = 2; i <= paginas; i++) {
        doc.setPage(i);
        if (isoTinta) doc.addImage(isoTinta, "PNG", M, 7.4, 5.6, 5.6);
        texto("OMNIACCESS", M + (isoTinta ? 7.4 : 0), 11.5, { tam: 7.6, negrita: true, col: COLOR.tinta, espaciado: 0.5 });
        texto(`Reporte de rastreo  ·  ${deQuien}  ·  ${periodoEnPalabras(r)}`, W - M, 11.5, { tam: 7.4, col: COLOR.gris, alinear: "right" });
        color(COLOR.linea, "linea"); doc.setLineWidth(0.25); doc.line(M, 15, W - M, 15);
        doc.line(M, H - 11, W - M, H - 11);
        texto(`${marca.pie}${marca.contacto ? `  ·  ${marca.contacto}` : ""}`, M, H - 6.5, { tam: 7, col: COLOR.grisClaro });
        texto(`Emitido el ${emitido} por ${marca.preparadoPor || generadoPor}  ·  Página ${i} de ${paginas}`, W - M, H - 6.5, { tam: 7, col: COLOR.grisClaro, alinear: "right" });
    }
    return Buffer.from(doc.output("arraybuffer"));
}
