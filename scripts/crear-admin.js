#!/usr/bin/env node
/**
 * Crear (o resetear) un usuario ADMINISTRADOR, preguntando nombre y contraseña por teclado.
 *
 *   cd /opt/OmniAccess && node scripts/crear-admin.js
 *
 * Por qué existe: la única forma de tener el primer usuario en una instalación nueva era
 * scripts/seed-admin.ts, que trae un usuario y una contraseña escritos en el código (y la guarda
 * en claro). En una instancia nueva eso deja una cuenta con una clave que conoce cualquiera que
 * lea el repo. Este script no guarda nada en el código: la clave la escribe quien instala, no se
 * muestra en pantalla, y se guarda con bcrypt (lo mismo que hace el login al migrar claves viejas).
 *
 * Si el usuario ya existe (mismo nombre), se le cambia la contraseña y se lo deja como ADMIN.
 */
const readline = require("readline");
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

/** Largo mínimo de la clave: un panel publicado en internet no se abre con cuatro letras. */
const LARGO_MINIMO = 10;
/** El costo de bcrypt: el mismo que usa el login (src/app/actions/auth.ts). */
const COSTO_BCRYPT = 12;

function preguntar(texto, oculto = false) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        if (oculto) {
            // Se escribe la pregunta y después no se repite lo que se tipea.
            rl._writeToOutput = (s) => { if (!rl.silenciar) rl.output.write(s); };
        }
        rl.question(texto, (r) => { rl.close(); if (oculto) process.stdout.write("\n"); resolve(r.trim()); });
        if (oculto) rl.silenciar = true;
    });
}

async function main() {
    if (!process.stdin.isTTY) { console.error("Correlo en una terminal: pregunta la contraseña por teclado."); process.exit(1); }
    const nombre = await preguntar("Usuario (con este nombre se entra): ");
    if (!nombre) { console.error("Falta el nombre."); process.exit(1); }
    const clave = await preguntar("Contraseña: ", true);
    if (clave.length < LARGO_MINIMO) { console.error(`La contraseña tiene que tener al menos ${LARGO_MINIMO} caracteres.`); process.exit(1); }
    const repetida = await preguntar("Repetila: ", true);
    if (clave !== repetida) { console.error("No coinciden."); process.exit(1); }

    const prisma = new PrismaClient();
    try {
        const hash = await bcrypt.hash(clave, COSTO_BCRYPT);
        let usuario = await prisma.user.findFirst({ where: { name: nombre } });
        if (usuario) usuario = await prisma.user.update({ where: { id: usuario.id }, data: { role: "ADMIN" } });
        else usuario = await prisma.user.create({ data: { name: nombre, role: "ADMIN" } });
        await prisma.credential.deleteMany({ where: { userId: usuario.id, type: "PASSWORD" } });
        await prisma.credential.create({ data: { userId: usuario.id, type: "PASSWORD", value: hash } });
        console.log(`Listo: «${nombre}» es administrador. Ya podés entrar con esa contraseña.`);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
