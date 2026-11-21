/** ¿El dominio del remitente autoriza al servidor por el que salimos? (lib/correo-dominio) */
import test from "node:test";
import assert from "node:assert/strict";
import { dominioDe, juzgarDominio, politicaDmarc, spfConGoogle, type DatosDns } from "@/lib/correo-dominio";

const dns = (d: Partial<DatosDns>): DatosDns => ({ spf: null, spfAbierto: "", dmarc: null, dkim: false, sePudo: true, ...d });
const GMAIL = "smtp.gmail.com";

test("el dominio sale del remitente, con nombre o sin él", () => {
    assert.equal(dominioDe('"OmniAccess · Barrio" <censo@Ejemplo.com.uy>'), "ejemplo.com.uy");
    assert.equal(dominioDe("censo@ejemplo.com.uy"), "ejemplo.com.uy");
    assert.equal(dominioDe("sin arroba"), "");
});

test("el caso del 21/11: SPF sin Google, sin firma y política de cuarentena → va a spam", () => {
    const j = juzgarDominio({
        desde: "Barrio <avisos@ejemplo.com.uy>", host: GMAIL,
        dns: dns({ spf: "v=spf1 +a +mx +ip4:203.0.113.7 ~all", dmarc: "v=DMARC1;p=quarantine;sp=quarantine;adkim=r;aspf=s" }),
    });
    assert.equal(j.estado, "mal");
    assert.match(j.titulo, /spam/);
    // El arreglo agrega a Google y no le saca nada a lo que ya estaba autorizado.
    assert.equal(j.arreglo[0].valor, "v=spf1 include:_spf.google.com +a +mx +ip4:203.0.113.7 ~all");
    assert.match(j.arreglo[1].donde, /google\._domainkey\.ejemplo\.com\.uy/);
});

test("con política de rechazo no dice spam: dice que se rechazan", () => {
    const j = juzgarDominio({ desde: "a@ejemplo.com", host: GMAIL, dns: dns({ dmarc: "v=DMARC1; p=reject" }) });
    assert.equal(j.estado, "mal");
    assert.match(j.titulo, /rechazar/);
});

test("autorizado y firmado → bien, sin nada que arreglar", () => {
    const j = juzgarDominio({ desde: "a@ejemplo.com", host: GMAIL, dns: dns({ spf: "v=spf1 include:_spf.google.com ~all", dkim: true, dmarc: "v=DMARC1; p=quarantine" }) });
    assert.equal(j.estado, "bien");
    assert.equal(j.arreglo.length, 0);
});

test("Google puede estar adentro de otro include", () => {
    const j = juzgarDominio({ desde: "a@ejemplo.com", host: GMAIL, dns: dns({ spf: "v=spf1 include:correo.ejemplo.net ~all", spfAbierto: " include:correo.ejemplo.net v=spf1 include:_spf.google.com ~all", dkim: true }) });
    assert.equal(j.estado, "bien");
});

test("una de las dos cosas alcanza para pasar, y se avisa cuál falta", () => {
    const soloSpf = juzgarDominio({ desde: "a@ejemplo.com", host: GMAIL, dns: dns({ spf: "v=spf1 include:_spf.google.com ~all" }) });
    assert.equal(soloSpf.estado, "aviso");
    assert.match(soloSpf.arreglo[0].donde, /_domainkey/);
    const soloFirma = juzgarDominio({ desde: "a@ejemplo.com", host: GMAIL, dns: dns({ spf: "v=spf1 a ~all", dkim: true }) });
    assert.equal(soloFirma.estado, "aviso");
    assert.equal(soloFirma.arreglo[0].valor, "v=spf1 include:_spf.google.com a ~all");
});

test("lo que no se pudo mirar no se da por bueno", () => {
    assert.equal(juzgarDominio({ desde: "a@ejemplo.com", host: GMAIL, dns: dns({ sePudo: false }) }).estado, "no-se");
    // Otro proveedor: no hay cómo saber qué tiene que nombrar el SPF.
    assert.equal(juzgarDominio({ desde: "a@ejemplo.com", host: "mail.ejemplo.com", dns: dns({}) }).estado, "no-se");
});

test("una casilla de Gmail por Gmail no tiene nada que configurar", () => {
    assert.equal(juzgarDominio({ desde: "alguien@gmail.com", host: GMAIL, dns: dns({ sePudo: false }) }).estado, "bien");
});

test("la política y el SPF corregido", () => {
    assert.equal(politicaDmarc("v=DMARC1;p=quarantine;sp=none"), "quarantine");
    assert.equal(politicaDmarc("v=DMARC1; sp=reject; p=none"), "none");
    assert.equal(politicaDmarc(null), null);
    assert.equal(spfConGoogle(null), "v=spf1 include:_spf.google.com ~all");
    assert.equal(spfConGoogle("v=spf1 include:_spf.google.com ~all"), "v=spf1 include:_spf.google.com ~all");
});
