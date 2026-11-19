import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";

export const dynamic = "force-dynamic";

/**
 * La planilla en blanco para cargar las invitaciones del censo.
 *
 * Pedido de Nico (19/11): «debe tener una plantilla descargable tipo template, para poder subir
 * e importar».
 *
 * Por qué existe: el importador adivina bastante —reconoce «lote / unidad / padrón / casa» y
 * «correo / e-mail / mail», y si no hay cabecera busca la columna que tenga arrobas—, pero la
 * administración del barrio no tiene por qué saber eso. Mandar un archivo con las columnas ya
 * puestas convierte «armá una planilla» en «completá esta», que es un pedido que se puede hacer
 * por correo sin explicar nada.
 *
 * Dos decisiones:
 *  · **Los ejemplos van en la SEGUNDA hoja.** El importador lee sólo la primera, así que una
 *    planilla devuelta sin borrar los ejemplos no da de alta tres lotes inventados. Un ejemplo
 *    que se cuela como dato real es peor que no poner ejemplos.
 *  · **El correo queda como texto.** Excel convierte una dirección en hipervínculo y, al leerla
 *    de vuelta, la celda puede venir como objeto en vez de cadena.
 */
export async function GET() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
    const s: any = await getSession().catch(() => null);
    if (!s) return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
    if (!permisosDeSesion(s).includes("usuarios.editar")) return NextResponse.json({ error: "Tu rol no puede manejar el censo." }, { status: 403 });

    const wb = new ExcelJS.Workbook();
    wb.creator = "OmniAccess";
    wb.created = new Date();

    const h = wb.addWorksheet("Invitaciones", { views: [{ state: "frozen", ySplit: 1 }] });
    h.columns = [
        { header: "Lote", key: "lote", width: 14 },
        { header: "Nombre", key: "nombre", width: 34 },
        { header: "Correo", key: "correo", width: 38 },
    ];
    const cab = h.getRow(1);
    cab.height = 22;
    cab.eachCell((c) => {
        c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A0E14" } };
        c.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    });
    /* 400 filas con formato de texto: así un lote «007» no se guarda como 7, que es el error que
       aparece siempre en estas planillas. */
    for (let i = 2; i <= 401; i++) {
        const f = h.getRow(i);
        f.getCell(1).numFmt = "@";
        f.getCell(3).numFmt = "@";
    }

    const g = wb.addWorksheet("Cómo se completa");
    g.columns = [{ width: 16 }, { width: 34 }, { width: 40 }, { width: 46 }];
    const renglones: [string, string, string, string][] = [
        ["Lote", "Nombre", "Correo", "Qué hace OmniAccess con esta fila"],
        ["101", "María Pereyra", "maria.pereyra@ejemplo.com", "Da de alta la invitación del lote 101 con su clave."],
        ["102 A", "Juan Gómez", "jgomez@ejemplo.com", "Los espacios se sacan solos: queda como 102A."],
        ["Lote 103", "", "fliarodriguez@ejemplo.com", "La palabra «lote» se saca sola. El nombre puede ir vacío."],
        ["104", "Ana Silva", "", "Queda avisada como lote sin correo: no se manda nada."],
        ["", "", "", ""],
        ["Reglas", "", "", ""],
        ["", "Una fila por lote.", "", "Si un lote aparece dos veces, vale la última."],
        ["", "El nombre es opcional.", "", "Si está, el correo saluda por nombre."],
        ["", "Reimportar no cambia las claves ya enviadas.", "", "Sólo corrige correos y nombres; quien ya recibió el suyo sigue entrando."],
        ["", "Se puede subir .xlsx o .csv.", "", "Las columnas pueden estar en cualquier orden."],
        ["", "Borrá esta hoja o dejala: no se lee.", "", "OmniAccess importa solamente la primera hoja."],
    ];
    renglones.forEach((r, i) => {
        const f = g.addRow(r);
        if (i === 0 || r[0] === "Reglas") f.font = { bold: true };
        if (i === 0) f.eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A0E14" } }; });
        f.getCell(4).alignment = { wrapText: true, vertical: "top" };
    });

    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(buf as ArrayBuffer, {
        headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": 'attachment; filename="censo-invitaciones-plantilla.xlsx"',
            "Cache-Control": "no-store",
        },
    });
}
