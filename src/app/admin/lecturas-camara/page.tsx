import { redirect } from "next/navigation";

/** La pantalla se llama «Procesamiento LPR» desde el 25/11 (pedido de Nico); la dirección vieja sigue llevando ahí. */
export default function LecturasCamaraVieja() { redirect("/admin/procesamiento-lpr"); }
