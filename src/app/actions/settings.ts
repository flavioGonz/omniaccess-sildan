"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import {
    S3Client,
    ListObjectsV2Command,
    GetBucketLifecycleConfigurationCommand,
    PutBucketLifecycleConfigurationCommand,
    HeadObjectCommand
} from "@aws-sdk/client-s3";
import fs from "fs/promises";
import path from "path";
import axios from "axios";
import { fechaHora } from "@/lib/fechas";

// ... existing code ...

export async function getSetting(key: string) {
    try {
        const setting = await prisma.setting.findUnique({
            where: { key },
        });
        return setting;
    } catch (error) {
        console.error(`Error getting setting ${key}:`, error);
        return null;
    }
}

export async function updateSetting(key: string, value: string) {
    try {
        const setting = await prisma.setting.upsert({
            where: { key },
            update: { value },
            create: { key, value },
        });
        revalidatePath("/admin/configuracion");
        return setting;
    } catch (error) {
        console.error(`Error updating setting ${key}:`, error);
        throw error; // Re-throw for update actions so UI shows error
    }
}

export async function purgeAccessEvents() {
    console.log("Starting purge process...");

    const retentionSetting = await getSetting("dataRetentionMonths");
    const retentionMonths = retentionSetting ? parseInt(retentionSetting.value, 10) : 6; // Default to 6 months if not set

    if (isNaN(retentionMonths) || retentionMonths <= 0) {
        console.error("Invalid retention period. Aborting purge.");
        throw new Error("Período de retención inválido.");
    }

    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - retentionMonths);

    console.log(`Purging events older than: ${cutoffDate.toISOString()}`);

    try {
        const { count } = await prisma.accessEvent.deleteMany({
            where: {
                createdAt: {
                    lt: cutoffDate,
                },
            },
        });

        console.log(`Successfully purged ${count} events.`);
        revalidatePath("/admin/history"); // Revalidate history page after purge
        return { success: true, count };

    } catch (error) {
        console.error("Failed to purge old access events:", error);
        throw new Error("La purga de eventos falló.");
    }
}

export async function getS3InternalClient() {
    let endpoint, accessKey, secretKey;
    try {
        [endpoint, accessKey, secretKey] = await Promise.all([
            prisma.setting.findUnique({ where: { key: "S3_ENDPOINT" } }),
            prisma.setting.findUnique({ where: { key: "S3_ACCESS_KEY" } }),
            prisma.setting.findUnique({ where: { key: "S3_SECRET_KEY" } }),
        ]);
    } catch (e) {
        console.warn("Failed to fetch S3 settings from DB, falling back to env/defaults", e);
    }

    return new S3Client({
        endpoint: endpoint?.value || process.env.S3_ENDPOINT || "http://192.168.99.108:9000",
        region: "us-east-1",
        credentials: {
            accessKeyId: accessKey?.value || process.env.S3_ACCESS_KEY || "root",
            secretAccessKey: secretKey?.value || process.env.S3_SECRET_KEY || "flavio20",
        },
        forcePathStyle: true,
    });
}

export async function getBucketLifecycle(bucketName: string) {
    try {
        const client = await getS3InternalClient();
        const command = new GetBucketLifecycleConfigurationCommand({ Bucket: bucketName });
        const response = await client.send(command);
        return { success: true, days: response.Rules?.[0]?.Expiration?.Days || 0 };
    } catch (error: any) {
        if (error.name === 'NoSuchLifecycleConfiguration') return { success: true, days: 0 };
        return { success: false, message: error.message };
    }
}

export async function updateBucketLifecycle(bucketName: string, days: number) {
    try {
        const client = await getS3InternalClient();
        const command = new PutBucketLifecycleConfigurationCommand({
            Bucket: bucketName,
            LifecycleConfiguration: {
                Rules: days > 0 ? [
                    {
                        ID: `RetentionRule-${bucketName}`,
                        Status: "Enabled",
                        Filter: { Prefix: "" },
                        Expiration: { Days: days }
                    }
                ] : []
            }
        });
        await client.send(command);
        return { success: true };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

export async function testS3Connection(bucketType: "lpr" | "face" = "lpr") {
    try {
        // Fetch config from DB
        const [endpoint, accessKey, secretKey, bucketLpr, bucketFace] = await Promise.all([
            prisma.setting.findUnique({ where: { key: "S3_ENDPOINT" } }),
            prisma.setting.findUnique({ where: { key: "S3_ACCESS_KEY" } }),
            prisma.setting.findUnique({ where: { key: "S3_SECRET_KEY" } }),
            prisma.setting.findUnique({ where: { key: "S3_BUCKET_LPR" } }),
            prisma.setting.findUnique({ where: { key: "S3_BUCKET_FACE" } }),
        ]);

        const config = {
            endpoint: endpoint?.value || process.env.S3_ENDPOINT || "http://192.168.99.108:9000",
            accessKey: accessKey?.value || process.env.S3_ACCESS_KEY || "root",
            secretKey: secretKey?.value || process.env.S3_SECRET_KEY || "flavio20",
            bucketName: bucketType === "lpr"
                ? (bucketLpr?.value || process.env.S3_BUCKET || "lpr")
                : (bucketFace?.value || "face")
        };

        const client = new S3Client({
            endpoint: config.endpoint,
            region: "us-east-1",
            credentials: {
                accessKeyId: config.accessKey,
                secretAccessKey: config.secretKey,
            },
            forcePathStyle: true,
        });

        const command = new ListObjectsV2Command({
            Bucket: config.bucketName,
            MaxKeys: 1
        });

        await client.send(command);
        return { success: true, message: `Conexión exitosa al bucket "${config.bucketName}"` };
    } catch (error: any) {
        console.error("S3 Test Connection Failed:", error);
        return {
            success: false,
            message: `Error de conexión: ${error.message || "Error desconocido"}`
        };
    }
}

/**
 * El tamaño y la cantidad de un bucket se cuentan recorriéndolo entero (hasta 50.000
 * objetos): en lpr-prod son segundos. Se recuerda unos minutos en memoria: el número no
 * cambia tan rápido como para medirlo en cada clic del explorador.
 */
const CACHE_STATS_MS = 5 * 60 * 1000;
const cacheStats = new Map<string, { en: number; valor: any }>();

export async function getBucketStats(bucketName: string) {
    const guardado = cacheStats.get(bucketName);
    if (guardado && Date.now() - guardado.en < CACHE_STATS_MS) return guardado.valor;
    try {
        const client = await getS3InternalClient();
        let totalSize = 0;
        let fileCount = 0;
        let pages = 0;
        const MAX_PAGES = 50;
        let truncated = false;

        const fetchObjects = async (token?: string): Promise<void> => {
            if (pages >= MAX_PAGES) {
                truncated = true;
                return;
            }
            const cmd = new ListObjectsV2Command({
                Bucket: bucketName,
                ContinuationToken: token,
            });

            const res = await client.send(cmd);
            pages++;

            if (res.Contents) {
                fileCount += res.Contents.length;
                for (const obj of res.Contents) {
                    totalSize += obj.Size || 0;
                }
            }

            if (res.IsTruncated && res.NextContinuationToken && pages < MAX_PAGES) {
                await fetchObjects(res.NextContinuationToken);
            } else if (res.IsTruncated) {
                truncated = true;
            }
        };

        await fetchObjects();

        const valor = { success: true, size: totalSize, count: fileCount, truncated };
        cacheStats.set(bucketName, { en: Date.now(), valor });
        return valor;
    } catch (error: any) {
        console.error("Error getting stats for bucket " + bucketName + ":", error);
        return { success: false, message: error.message };
    }
}

export async function testDbConnection() {
    try {
        await prisma.$queryRaw`SELECT 1`;
        return { success: true, message: "Conexión a base de datos exitosa" };
    } catch (error: any) {
        console.error("DB Connection Failed:", error);
        return { success: false, message: error.message };
    }
}

/**
 * Tests a connection to an external database string
 */
export async function testExternalDbConnection(url: string) {
    const { PrismaClient } = await import('@prisma/client');
    const tempPrisma = new PrismaClient({
        datasources: {
            db: {
                url: url
            }
        }
    });

    try {
        await tempPrisma.$connect();
        await tempPrisma.$queryRaw`SELECT 1`;

        // Check if tables exist by looking for a common table
        const tables = await tempPrisma.$queryRaw`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        ` as { table_name: string }[];

        const isVirgin = tables.length === 0;

        return {
            success: true,
            message: "Conexión exitosa",
            isVirgin
        };
    } catch (error: unknown) {
        return { success: false, message: error instanceof Error ? error.message : String(error) };
    } finally {
        await tempPrisma.$disconnect();
    }
}

/**
 * Updates the DATABASE_URL in the .env file and restarts the app if possible
 */
export async function updateDatabaseUrl(newUrl: string) {
    try {
        const envPath = path.join(process.cwd(), '.env');
        let envContent = await fs.readFile(envPath, 'utf8');

        const dbUrlRegex = /^DATABASE_URL=.*$/m;
        if (dbUrlRegex.test(envContent)) {
            envContent = envContent.replace(dbUrlRegex, `DATABASE_URL="${newUrl}"`);
        } else {
            envContent += `\nDATABASE_URL="${newUrl}"`;
        }

        await fs.writeFile(envPath, envContent, 'utf8');

        // Trigger a restart after a short delay to allow the response to reach the client
        setTimeout(() => {
            console.log("Restarting app to apply new DATABASE_URL...");
            process.exit(0);
        }, 1500);

        return { success: true, message: "URL de base de datos actualizada. Reiniciando servicios en 1.5s..." };
    } catch (error: unknown) {
        console.error("Failed to update .env:", error);
        return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Runs migrations on the current database
 */
export async function runDatabaseMigrations() {
    const { exec } = await import('child_process');
    const util = await import('util');
    const execPromise = util.promisify(exec);

    try {
        // Run prisma migrate deploy
        const { stdout, stderr } = await execPromise('npx prisma migrate deploy');
        console.log('Migration stdout:', stdout);
        if (stderr) console.warn('Migration stderr:', stderr);

        return { success: true, message: "Migraciones aplicadas correctamente" };
    } catch (error: unknown) {
        console.error("Migration failed:", error);
        return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
}

export async function getDbStats() {
    try {
        const dbSizeQuery = await prisma.$queryRaw`SELECT pg_size_pretty(pg_database_size(current_database())) as size` as { size: string }[];

        const tableStats = await prisma.$queryRaw`
            SELECT 
                relname as table_name,
                n_live_tup as row_count,
                pg_size_pretty(pg_total_relation_size(relid)) as total_size
            FROM pg_stat_user_tables
            ORDER BY n_live_tup DESC;
        ` as { table_name: string, row_count: number, total_size: string }[];

        const dbUrl = process.env.DATABASE_URL || "";
        const dbMatch = dbUrl.match(/@([^/:]+):?(\d+)?/);
        const dbHost = dbMatch ? dbMatch[1] : '127.0.0.1';
        const dbPort = dbMatch ? (dbMatch[2] || '5432') : '5432';

        return {
            success: true,
            totalSize: dbSizeQuery[0]?.size || "0 B",
            tables: tableStats,
            host: dbHost,
            port: dbPort
        };
    } catch (error: unknown) {
        console.error("Error getting DB stats:", error);
        return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Las tablas que la restauración VACÍA, con lo necesario para contarlas y borrarlas.
 *
 * ── POR QUÉ ESTA LISTA EXISTE ───────────────────────────────────────────────────────
 *
 * Porque el respaldo y el borrado se habían separado sin que nadie lo decidiera. El
 * respaldo guardaba nueve tablas; la restauración vaciaba once. Las cuatro de la
 * diferencia —`callEvent`, `hardwareMirror`, `topologyNode`, `wahaRequestLog`— se
 * borraban y no volvían NUNCA, porque no estaban en el archivo.
 *
 * No es hipotético: San Nicolás tiene hoy 16 filas de `topologyNode`, que es el dibujo de
 * la red. Restaurar un respaldo las borraba y la pantalla decía "Base de datos restaurada
 * correctamente".
 *
 * Y `hardwareMirror` es peor todavía desde que existe el borrado de tarjetas: es el único
 * lugar que sabe en qué lector quedó cada tarjeta. Perderlo es perder la capacidad de
 * sacarlas.
 *
 * Con una sola lista, las dos mitades no pueden volver a discrepar: lo que se borra es
 * exactamente lo que se guarda.
 */
const TABLAS_DEL_RESPALDO = [
    { clave: "wahaRequestLog", nombre: "Mensajes de WhatsApp" },
    { clave: "callEvent", nombre: "Llamadas del portero" },
    { clave: "events", nombre: "Eventos de acceso", modelo: "accessEvent" },
    { clave: "hardwareMirror", nombre: "Espejo de credenciales en equipos" },
    { clave: "credentials", nombre: "Credenciales", modelo: "credential" },
    { clave: "vehicles", nombre: "Vehículos", modelo: "vehicle" },
    { clave: "accessGroups", nombre: "Grupos de acceso", modelo: "accessGroup" },
    { clave: "parkingSlots", nombre: "Plazas de parking", modelo: "parkingSlot" },
    { clave: "users", nombre: "Usuarios", modelo: "user" },
    { clave: "units", nombre: "Unidades", modelo: "unit" },
    { clave: "topologyNode", nombre: "Nodos de topología" },
] as const;

const modeloDe = (t: { clave: string; modelo?: string }) => (prisma as any)[t.modelo || t.clave];

export async function downloadBackup() {
    try {
        const [
            users, vehicles, devices, events, units, credentials,
            accessGroups, settings, parkingSlots,
            callEvent, hardwareMirror, topologyNode, wahaRequestLog,
        ] = await Promise.all([
            prisma.user.findMany(),
            prisma.vehicle.findMany(),
            prisma.device.findMany(),
            /*
             * SIN `take: 5000`.
             *
             * Estaba limitado a los últimos cinco mil eventos mientras la restauración los
             * borraba TODOS. Con seis meses de retención eso significa que restaurar un
             * respaldo truncaba el historial de accesos del barrio a cinco mil filas —y
             * el historial de accesos es el registro que importa cuando alguien pregunta
             * quién entró— y después informaba éxito.
             *
             * Si algún día el volumen molesta, la respuesta es paginar o comprimir, no
             * tirar historia en silencio.
             */
            prisma.accessEvent.findMany({ orderBy: { timestamp: "desc" } }),
            prisma.unit.findMany(),
            prisma.credential.findMany(),
            prisma.accessGroup.findMany({ include: { users: true, devices: true } }),
            prisma.setting.findMany(),
            prisma.parkingSlot.findMany(),
            /* Las cuatro que faltaban. Ver TABLAS_DEL_RESPALDO. */
            prisma.callEvent.findMany(),
            prisma.hardwareMirror.findMany(),
            prisma.topologyNode.findMany(),
            prisma.wahaRequestLog.findMany(),
        ]);

        const data = {
            users, vehicles, devices, events, units, credentials,
            accessGroups, settings, parkingSlots,
            callEvent, hardwareMirror, topologyNode, wahaRequestLog,
        };

        const backupData = {
            /* 1.2: la versión en la que el archivo cubre todo lo que la restauración borra.
               Un archivo 1.1 restaurado con este código dispara el chequeo de abajo. */
            version: "1.2",
            timestamp: new Date().toISOString(),
            /* El recuento va EN el archivo. Sin esto, mirar un respaldo y saber si trae el
               historial entero o una punta exigía abrirlo y contar a mano. */
            filas: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, (v as any[]).length])),
            data,
        };

        return { success: true, data: backupData };
    } catch (error: unknown) {
        console.error("Backup failed:", error);
        return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Restaurar un respaldo.
 *
 * ── LO QUE SE CHEQUEA ANTES DE BORRAR NADA ──────────────────────────────────────────
 *
 * Un archivo viejo (versión 1.1) no trae las cuatro tablas que esta función vacía. Si se
 * restaurara igual, borraría el espejo de credenciales y el dibujo de la topología y no
 * los repondría — que es exactamente el defecto que esto viene a cerrar, sólo que
 * disparado por un archivo en vez de por el código.
 *
 * Así que primero se compara: para cada tabla que se va a vaciar, si el archivo no la
 * trae Y la base tiene filas, se corta y se dice cuál y cuántas. El operador decide si
 * sigue con `forzar`.
 *
 * Es la misma regla que rige todo lo demás de esta sesión: no afirmar lo que no se puede
 * sostener. Acá la afirmación implícita era "esto te devuelve tu base", y no era cierta.
 */
export async function restoreBackup(
    backupData: any,
    merge: boolean = false,
    opciones?: { forzar?: boolean },
) {
    try {
        const data = backupData?.data;
        if (!data) throw new Error("Formato de backup inválido");

        /* El chequeo previo. Sólo importa cuando se va a borrar. */
        if (!merge) {
            const faltantes: string[] = [];
            for (const t of TABLAS_DEL_RESPALDO) {
                const enElArchivo = Array.isArray(data[t.clave]) ? data[t.clave].length : null;
                if (enElArchivo !== null) continue;
                const enLaBase = await modeloDe(t).count().catch(() => 0);
                if (enLaBase > 0) faltantes.push(`${t.nombre} (${enLaBase} filas)`);
            }
            if (faltantes.length && !opciones?.forzar) {
                return {
                    success: false,
                    message: `Este respaldo es de una versión anterior y no incluye: ${faltantes.join(", ")}. `
                        + `Restaurarlo las borraría sin poder reponerlas. Bajá un respaldo nuevo, o forzá si estás seguro.`,
                    faltantes,
                };
            }
        }

        /* Cuánto había antes, para poder decir después qué pasó de verdad. */
        const antes: Record<string, number> = {};
        for (const t of TABLAS_DEL_RESPALDO) {
            antes[t.clave] = await modeloDe(t).count().catch(() => 0);
        }

        // Transaction to ensure integrity
        await prisma.$transaction(async (tx) => {
            // 1. Clean existing data IF NOT merging (Order matters for constraints)
            if (!merge) {
                await tx.wahaRequestLog.deleteMany();
                await tx.accessEvent.deleteMany();
                await tx.callEvent.deleteMany();
                await tx.hardwareMirror.deleteMany();
                await tx.credential.deleteMany();
                await tx.vehicle.deleteMany();
                await tx.accessGroup.deleteMany();
                await tx.parkingSlot.deleteMany();
                await tx.user.deleteMany();
                await tx.unit.deleteMany();
                await tx.topologyNode.deleteMany();
                // Los Setting no se borran a propósito: traen la conexión a la base, a S3 y
                // al WhatsApp. Vaciarlos dejaría la instalación sin poder hablar con nada,
                // incluida la base desde la que se está restaurando.
            }

            // 2. Restore/Merge data (Order matters)

            // Units first (Parent of many)
            if (data.units?.length > 0) {
                // Separate parents and children if there are any self-relations
                await tx.unit.createMany({
                    data: data.units.map((u: any) => ({ ...u, parentId: null })),
                    skipDuplicates: true
                });
                // Update parentId after all units exist
                for (const u of data.units) {
                    if (u.parentId) {
                        await tx.unit.update({
                            where: { id: u.id },
                            data: { parentId: u.parentId }
                        });
                    }
                }
            }

            // Users & Parking Slots
            if (data.parkingSlots?.length > 0) {
                await tx.parkingSlot.createMany({
                    data: data.parkingSlots,
                    skipDuplicates: true
                });
            }

            if (data.users?.length > 0) {
                await tx.user.createMany({
                    data: data.users,
                    skipDuplicates: true
                });
            }

            // Vehicles & Credentials
            if (data.vehicles?.length > 0) {
                await tx.vehicle.createMany({
                    data: data.vehicles,
                    skipDuplicates: true
                });
            }
            if (data.credentials?.length > 0) {
                await tx.credential.createMany({
                    data: data.credentials,
                    skipDuplicates: true
                });
            }

            // Devices & Groups
            if (data.devices?.length > 0) {
                for (const device of data.devices) {
                    await tx.device.upsert({
                        where: { id: device.id },
                        create: device,
                        update: device
                    });
                }
            }

            if (data.accessGroups?.length > 0) {
                for (const group of data.accessGroups) {
                    const { users, devices, ...groupData } = group;
                    await tx.accessGroup.upsert({
                        where: { id: group.id },
                        create: groupData,
                        update: groupData
                    });

                    // Reconnect relations
                    if (users?.length > 0) {
                        await tx.accessGroup.update({
                            where: { id: group.id },
                            data: { users: { connect: users.map((u: any) => ({ id: u.id })) } }
                        });
                    }
                    if (devices?.length > 0) {
                        await tx.accessGroup.update({
                            where: { id: group.id },
                            data: { devices: { connect: devices.map((d: any) => ({ id: d.id })) } }
                        });
                    }
                }
            }

            // Events last
            if (data.events?.length > 0) {
                const events = data.events.map((e: any) => ({
                    ...e,
                    timestamp: new Date(e.timestamp),
                    createdAt: new Date(e.createdAt)
                }));
                await tx.accessEvent.createMany({
                    data: events,
                    skipDuplicates: true
                });
            }

            /* Las cuatro que antes se borraban y no volvían. Van después de los
               dispositivos porque `callEvent` y `hardwareMirror` cuelgan de ellos. */
            if (data.callEvent?.length > 0) {
                await tx.callEvent.createMany({
                    data: data.callEvent.map((c: any) => ({
                        ...c,
                        timestamp: new Date(c.timestamp),
                        createdAt: new Date(c.createdAt),
                    })),
                    skipDuplicates: true,
                });
            }
            if (data.hardwareMirror?.length > 0) {
                await tx.hardwareMirror.createMany({
                    data: data.hardwareMirror.map((m: any) => ({ ...m, lastUpdated: new Date(m.lastUpdated) })),
                    skipDuplicates: true,
                });
            }
            if (data.topologyNode?.length > 0) {
                await tx.topologyNode.createMany({
                    data: data.topologyNode.map((n: any) => ({
                        ...n,
                        createdAt: new Date(n.createdAt),
                        updatedAt: new Date(n.updatedAt),
                    })),
                    skipDuplicates: true,
                });
            }
            if (data.wahaRequestLog?.length > 0) {
                await tx.wahaRequestLog.createMany({
                    data: data.wahaRequestLog.map((w: any) => ({ ...w, timestamp: new Date(w.timestamp) })),
                    skipDuplicates: true,
                });
            }

            // Settings if included
            if (data.settings?.length > 0) {
                for (const s of data.settings) {
                    await tx.setting.upsert({
                        where: { key: s.key },
                        create: s,
                        update: s
                    });
                }
            }
        }, {
            timeout: 30000 // Increase timeout for large restores
        });

        /*
         * El informe cuenta la base DESPUÉS, no lo que el archivo traía.
         *
         * Antes esto devolvía `{ success: true }` y la pantalla decía "Base de datos
         * restaurada correctamente" pasara lo que pasara. `createMany` con
         * `skipDuplicates` puede saltear filas en silencio, y la diferencia entre lo que
         * había, lo que traía el archivo y lo que quedó es justamente lo que el operador
         * necesita para saber si confiar.
         */
        const despues: Record<string, number> = {};
        for (const t of TABLAS_DEL_RESPALDO) {
            despues[t.clave] = await modeloDe(t).count().catch(() => 0);
        }

        const perdidas = TABLAS_DEL_RESPALDO
            .filter((t) => despues[t.clave] < antes[t.clave])
            .map((t) => `${t.nombre}: ${antes[t.clave]} → ${despues[t.clave]}`);

        revalidatePath("/admin/settings");
        return {
            success: true,
            antes, despues,
            /* Si algo quedó con MENOS filas que antes, es una pérdida y se nombra. No
               siempre es un error —restaurar un respaldo viejo achica la base a
               propósito— pero tiene que decirse, no descubrirse. */
            message: perdidas.length
                ? `Restaurado, pero quedó con menos filas que antes en: ${perdidas.join("; ")}.`
                : `Restaurado. ${despues.users} usuarios, ${despues.events} eventos de acceso, ${despues.credentials} credenciales.`,
            perdidas,
        };
    } catch (error: unknown) {
        console.error("Restore failed:", error);
        return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
}

export async function populateDatabase() {
    try {
        const { exec } = await import('child_process');
        const util = await import('util');
        const execPromise = util.promisify(exec);

        // Run prisma seed
        const { stdout, stderr } = await execPromise('npx prisma db seed');
        console.log('Seed stdout:', stdout);
        if (stderr) console.warn('Seed stderr:', stderr);

        revalidatePath("/admin/settings");
        return { success: true, message: "Base de datos poblada con éxito desde el seed oficial" };
    } catch (error: unknown) {
        console.error("Seed failed:", error);
        return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
}

export async function saveHikvisionBrands(brands: Record<string, string>) {
    try {
        // Convert to sorted object string
        const sortedKeys = Object.keys(brands).sort((a, b) => parseInt(a) - parseInt(b));
        const entries = sortedKeys.map(key => `    ${key}: '${brands[key].replace(/'/g, "\\'")}'`).join(',\n');

        // 1. Update TS file
        const tsPath = path.join(process.cwd(), 'src', 'lib', 'hikvision-codes.ts');
        let tsContent = await fs.readFile(tsPath, 'utf8');

        const tsRegex = /(export const HIKVISION_VEHICLE_BRANDS: \{ \[key: number\]: string \} = \{)[\s\S]*?(\};)/;
        if (tsRegex.test(tsContent)) {
            const newTsBlock = `$1\n${entries}\n$2`;
            tsContent = tsContent.replace(tsRegex, newTsBlock);
            await fs.writeFile(tsPath, tsContent, 'utf8');
        } else {
            console.error("Could not find HIKVISION_VEHICLE_BRANDS in hikvision-codes.ts");
        }

        // 2. Update JS file
        const jsPath = path.join(process.cwd(), 'hikvision-codes.js');
        let jsContent = await fs.readFile(jsPath, 'utf8');

        // JS uses: const HIKVISION_VEHICLE_BRANDS = { ...
        const jsRegex = /(const HIKVISION_VEHICLE_BRANDS = \{)[\s\S]*?(\};)/;
        if (jsRegex.test(jsContent)) {
            const newJsBlock = `$1\n${entries}\n$2`;
            jsContent = jsContent.replace(jsRegex, newJsBlock);
            await fs.writeFile(jsPath, jsContent, 'utf8');
        } else {
            console.error("Could not find HIKVISION_VEHICLE_BRANDS in hikvision-codes.js");
        }

        return { success: true };
    } catch (error: any) {
        console.error("Failed to save brands:", error);
        return { success: false, message: error.message };
    }
}

export async function testWahaConnection(url: string, apiKey?: string) {
    try {
        const headers: any = {};
        if (apiKey) headers['X-Api-Key'] = apiKey;

        const response = await axios.get(`${url}/api/sessions`, {
            headers,
            timeout: 5000
        });

        return {
            success: true,
            sessions: response.data,
            message: "Conexión exitosa con WAHA"
        };
    } catch (error: any) {
        console.error("WAHA Test Connection Failed:", error);
        return {
            success: false,
            message: `Error de conexión: ${error.response?.data?.message || error.message}`
        };
    }
}

export async function testFaceEngineConnection(url: string, apiKey?: string) {
    try {
        const headers: any = {};
        if (apiKey) headers['x-api-key'] = apiKey;

        // CompareFace usually has a health or status endpoint, but let's try to reach the recognition API
        // or just a simple ping to the base url
        const response = await axios.get(`${url}/api/v1/recognition/subjects`, {
            headers,
            timeout: 5000
        });

        if (response.status === 200) {
            return {
                success: true,
                message: "Neural Engine Online (Subjects fetched successfully)"
            };
        }
        return { success: false, message: `Unexpected status code: ${response.status}` };
    } catch (error: any) {
        console.error("Face Engine Test Failed:", error.response?.data || error.message);
        // Even if unauthorized, it means reachable
        if (error.response?.status === 401) {
            return { success: false, message: "Error: API Key inválida o no proporcionada" };
        }
        return {
            success: false,
            message: `Error de conexión: ${error.message}`
        };
    }
}

export async function getWahaSessions(url: string, apiKey?: string) {
    try {
        const headers: any = {};
        if (apiKey) headers['X-Api-Key'] = apiKey;

        const response = await axios.get(`${url}/api/sessions`, { headers });
        return { success: true, data: response.data };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

export async function getWahaHistory() {
    try {
        const logs = await prisma.wahaRequestLog.findMany({
            orderBy: { timestamp: 'desc' },
            take: 50
        });

        return logs.map(log => ({
            id: log.id,
            user: log.fromNumber,
            command: log.messageBody,
            response: log.responseDetails || log.status,
            time: fechaHora(log.timestamp)
        }));
    } catch (error) {
        console.error("Failed to fetch WAHA history", error);
        return [];
    }
}
export async function getLearnedPlates() {
    try {
        const learnedPlates = await prisma.credential.findMany({
            where: {
                user: {
                    name: "Usuario Aprendizaje"
                },
                type: "PLATE"
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        const platesWithEvents = await Promise.all(learnedPlates.map(async (p) => {
            const lastEvent = await prisma.accessEvent.findFirst({
                where: { plateDetected: p.value },
                orderBy: { timestamp: 'desc' },
                select: { snapshotPath: true }
            });

            return {
                id: p.id,
                plate: p.value,
                timestamp: p.createdAt,
                snapshot: lastEvent?.snapshotPath || null
            };
        }));

        return platesWithEvents;
    } catch (error) {
        console.error("Error fetching learned plates:", error);
        return [];
    }
}

export async function clearLearnedPlates() {
    try {
        const learningUser = await prisma.user.findFirst({
            where: { name: "Usuario Aprendizaje" }
        });
        if (learningUser) {
            await prisma.credential.deleteMany({
                where: {
                    userId: learningUser.id,
                    type: "PLATE"
                }
            });
        }
        revalidatePath("/admin/settings");
        return { success: true };
    } catch (error) {
        console.error("Error clearing learned plates:", error);
        return { success: false, message: "Error al borrar las matrículas aprendidas" };
    }
}
export async function uploadBrandingFile(formData: FormData) {
    try {
        const file = formData.get("file") as File;
        if (!file) throw new Error("No se proporcionó ningún archivo");

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        const uploadDir = path.join(process.cwd(), "public", "branding");
        await fs.mkdir(uploadDir, { recursive: true });

        const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, "_")}`;
        const filePath = path.join(uploadDir, fileName);
        await fs.writeFile(filePath, buffer);

        // Se devuelve la URL de la ruta que lee del disco, no /branding/...: Next en producción
        // sólo sirve de /public lo que existía al compilar, y un logo recién subido daba 404.
        return { success: true, url: `/api/branding/${fileName}` };
    } catch (error: any) {
        console.error("Error uploading branding file:", error);
        return { success: false, message: error.message };
    }
}

export async function saveGuardBranding(settings: Record<string, string>) {
    try {
        await prisma.$transaction(
            Object.entries(settings).map(([key, value]) =>
                prisma.setting.upsert({
                    where: { key },
                    update: { value },
                    create: { key, value },
                })
            )
        );
        revalidatePath("/guard");
        return { success: true };
    } catch (error: any) {
        console.error("Error saving guard branding:", error);
        return { success: false, message: error.message };
    }
}

// ─── App Branding (login) ──────────────────────────────────────────────────
const APP_BRAND_KEYS = ["APP_BRAND_NAME", "APP_BRAND_SUBTITLE", "APP_BRAND_LOGO_URL", "APP_BRAND_LOGIN_BG_URL", "APP_BRAND_PRIMARY", "APP_BRAND_TESTIMONIALS"];

export async function getAppBranding() {
    const rows = await prisma.setting.findMany({ where: { key: { in: APP_BRAND_KEYS } } });
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;
    return {
        name: map.APP_BRAND_NAME || "OmniAccess",
        subtitle: map.APP_BRAND_SUBTITLE || "Plataforma unificada de control de acceso",
        logoUrl: map.APP_BRAND_LOGO_URL || "",
        loginBgUrl: map.APP_BRAND_LOGIN_BG_URL || "",
        primary: map.APP_BRAND_PRIMARY || "",
        testimonials: (() => { try { const a = JSON.parse(map.APP_BRAND_TESTIMONIALS || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } })(),
    };
}

// ─── Report Branding (PDF/Excel) ───────────────────────────────────────────
const REPORT_BRAND_KEYS = ["REPORT_COMPANY", "REPORT_TAGLINE", "REPORT_FOOTER", "REPORT_CONTACT", "REPORT_PRIMARY", "REPORT_ACCENT", "REPORT_TABLE_HEADER", "REPORT_TABLE_STRIPE", "REPORT_LOGO_URL", "REPORT_PREPARED_BY", "REPORT_AUTHORIZED_BY", "REPORT_COVER_URL"];

export async function getReportBranding() {
    const rows = await prisma.setting.findMany({ where: { key: { in: [...REPORT_BRAND_KEYS, "APP_BRAND_NAME", "APP_BRAND_LOGO_URL", "APP_BRAND_PRIMARY"] } } });
    const m: Record<string, string> = {};
    for (const r of rows) m[r.key] = r.value;
    const primary = m.REPORT_PRIMARY || m.APP_BRAND_PRIMARY || "#7c3aed";
    return {
        company: m.REPORT_COMPANY || m.APP_BRAND_NAME || "OmniAccess",
        tagline: m.REPORT_TAGLINE || "Reporte de aforo \u00b7 Control de Filas",
        footer: m.REPORT_FOOTER || m.REPORT_COMPANY || m.APP_BRAND_NAME || "OmniAccess",
        contact: m.REPORT_CONTACT || "",
        primary,
        accent: m.REPORT_ACCENT || primary,
        tableHeader: m.REPORT_TABLE_HEADER || primary,
        tableStripe: m.REPORT_TABLE_STRIPE || "#f7f4ff",
        logoUrl: m.REPORT_LOGO_URL || m.APP_BRAND_LOGO_URL || "",
        preparedBy: m.REPORT_PREPARED_BY || "",
        authorizedBy: m.REPORT_AUTHORIZED_BY || "",
        coverUrl: m.REPORT_COVER_URL || "",
    };
}

export async function saveAppBranding(settings: Record<string, string>) {
    try {
        await prisma.$transaction(
            Object.entries(settings).map(([key, value]) =>
                prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
            )
        );
        revalidatePath("/login");
        return { success: true };
    } catch (error: any) {
        console.error("Error saving app branding:", error);
        return { success: false, message: error.message };
    }
}

// --- PWA icon upload (resizes to 192/512/maskable into public/iconos) ---
export async function savePwaIcon(formData: FormData, pwa: string = "filas") {
    try {
        const file = formData.get("file") as File;
        if (!file) throw new Error("No se proporcionó ningún archivo");
        const buffer = Buffer.from(await file.arrayBuffer());
        const sharp = (await import("sharp")).default;
        const dir = path.join(process.cwd(), "public", "iconos");
        await fs.mkdir(dir, { recursive: true });
        const safe = pwa.replace(/[^a-z0-9]/gi, "") || "filas";
        await sharp(buffer).resize(192, 192, { fit: "cover" }).png().toFile(path.join(dir, `${safe}-192.png`));
        await sharp(buffer).resize(512, 512, { fit: "cover" }).png().toFile(path.join(dir, `${safe}-512.png`));
        await sharp(buffer).resize(512, 512, { fit: "cover" }).png().toFile(path.join(dir, `${safe}-512-maskable.png`));
        // Versionar el manifest para que las PWA instaladas vuelvan a pedir el icono nuevo
        try {
            const manifestPath = path.join(process.cwd(), "public", `manifest-${safe}.json`);
            const mani = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
            const v = Date.now();
            if (Array.isArray(mani.icons)) {
                mani.icons = mani.icons.map((ic: any) => ({ ...ic, src: String(ic.src).split("?")[0] + `?v=${v}` }));
                await fs.writeFile(manifestPath, JSON.stringify(mani, null, 2));
            }
        } catch {}
        return { success: true };
    } catch (error: any) {
        console.error("Error saving PWA icon:", error);
        return { success: false, message: error.message };
    }
}

// --- S3/MinIO browser actions ---
export async function listBuckets() {
    try {
        const client = await getS3InternalClient();
        const { ListBucketsCommand } = await import("@aws-sdk/client-s3");
        const res: any = await client.send(new ListBucketsCommand({}));
        return { success: true, buckets: (res.Buckets || []).map((b: any) => ({ name: b.Name, created: b.CreationDate })) };
    } catch (e: any) { console.error("listBuckets", e.message); return { success: false, message: e.message, buckets: [] as any[] }; }
}

/** Objetos por página del explorador: 60 miniaturas entran en una pantalla; el resto va con "Cargar más". Antes 200. */
const PAGINA_EXPLORADOR = 60;

export async function listBucketObjects(bucket: string, prefix: string = "", token?: string) {
    try {
        const client = await getS3InternalClient();
        const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
        const res: any = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, Delimiter: "/", MaxKeys: PAGINA_EXPLORADOR, ContinuationToken: token }));
        const folders = (res.CommonPrefixes || []).map((p: any) => p.Prefix as string);
        const objects = (res.Contents || []).filter((o: any) => o.Key !== prefix).map((o: any) => ({ key: o.Key as string, size: (o.Size || 0) as number, lastModified: o.LastModified as Date }));
        return { success: true, folders, objects, nextToken: res.IsTruncated ? (res.NextContinuationToken as string) : null };
    } catch (e: any) { console.error("listBucketObjects", e.message); return { success: false, message: e.message, folders: [] as string[], objects: [] as any[], nextToken: null }; }
}


// ── PWA Splash Screen designer (Branding) ──
const SPLASH_DEFAULT = {
    bgType: "color", color1: "#6d28d9", color2: "#0a0a0b", gradient: true, angle: 160,
    imageUrl: "", videoUrl: "", overlay: 0,
    showLogo: true, logoUrl: "", logoSize: 96,
    title: "OmniAccess", subtitle: "", titleColor: "#ffffff", subtitleColor: "#ffffffb3",
    spinner: true, spinnerColor: "#ffffff", duration: 1700,
};

export async function getSplashConfig(target: string) {
    const key = "SPLASH_" + String(target || "global").toUpperCase();
    try {
        let s = await prisma.setting.findUnique({ where: { key } });
        let usedFallback = false;
        if (!s?.value && target !== "global") { s = await prisma.setting.findUnique({ where: { key: "SPLASH_GLOBAL" } }); usedFallback = true; }
        const stored = s?.value ? JSON.parse(s.value) : {};
        return { ...SPLASH_DEFAULT, ...stored, _stored: !!s?.value, _fallback: usedFallback };
    } catch { return { ...SPLASH_DEFAULT, _stored: false, _fallback: false }; }
}

export async function saveSplashConfig(target: string, config: any) {
    const key = "SPLASH_" + String(target || "global").toUpperCase();
    try {
        const clean = { ...config }; delete clean._stored; delete clean._fallback;
        await prisma.setting.upsert({ where: { key }, update: { value: JSON.stringify(clean) }, create: { key, value: JSON.stringify(clean) } });
        return { success: true };
    } catch (e: any) { return { success: false, error: e?.message || "error" }; }
}

// ── Capacidad real del disco donde vive MinIO ─────────────────────────────
export async function getStorageCapacity() {
    const { statfs } = await import("fs/promises");
    const candidatos = [
        process.env.MINIO_DATA_DIR,
        "/datos/minio",
        "/var/lib/minio",
        "/datos",
        "/",
    ].filter(Boolean) as string[];

    for (const dir of candidatos) {
        try {
            const st: any = await statfs(dir);
            const total = Number(st.blocks) * Number(st.bsize);
            const free = Number(st.bavail) * Number(st.bsize);
            if (!total) continue;
            const used = total - free;
            return {
                success: true,
                path: dir,
                total,
                free,
                used,
                percent: Math.round((used / total) * 100),
            };
        } catch { }
    }
    return { success: false, path: null, total: 0, free: 0, used: 0, percent: 0 };
}

/**
 * Cuánto ocupan las capturas que NO están en el object storage.
 *
 * Existe porque la pantalla de almacenamiento mentía por omisión. Ofrecía una política de
 * retención sobre el bucket LPR mientras las capturas del seguimiento —que en San Nicolás
 * son las únicas que hay, porque todavía no hay cámaras de barrera— se escriben con
 * `fs.writeFileSync` en el disco del contenedor y no pasan por S3 en ningún momento. En
 * `tracking-worker.js` y en toda `api/tracking/` no aparece la palabra S3 una sola vez.
 *
 * Medido el 23 de setiembre de 2026: 368 MB en 1.214 archivos, y el bucket con una sola
 * carpeta de mapas. Un panel que configura la retención de un bucket vacío mientras el
 * disco crece sin control no está informando: está tapando.
 *
 * Así que la pantalla muestra los dos lugares, con lo que cada uno tiene. Que el número
 * del disco esté a la vista es lo que convierte "hay que decidir la retención" en algo que
 * se ve en vez de algo que hay que acordarse.
 */
export async function estadoCapturasLocales(): Promise<{
    ok: boolean; carpeta: string; archivos: number; bytes: number; masViejo: string | null; motivo?: string;
}> {
    const fs = await import("fs/promises");
    const path = await import("path");
    const carpeta = process.env.TRACKING_SHOTS_DIR || "/datos/track";
    try {
        const nombres = await fs.readdir(carpeta);
        let archivos = 0, bytes = 0, masViejo: number | null = null;
        for (const n of nombres) {
            if (!n.toLowerCase().endsWith(".jpg")) continue;
            try {
                const st = await fs.stat(path.join(carpeta, n));
                if (!st.isFile()) continue;
                archivos++; bytes += st.size;
                if (masViejo == null || st.mtimeMs < masViejo) masViejo = st.mtimeMs;
            } catch { /* un archivo que se borró entre el readdir y el stat no es un error */ }
        }
        return { ok: true, carpeta, archivos, bytes, masViejo: masViejo ? new Date(masViejo).toISOString() : null };
    } catch (e: any) {
        /* Se dice el motivo. Una carpeta que no existe y una sin permisos son problemas
           distintos, y las dos se verían igual como "0 archivos". */
        return { ok: false, carpeta, archivos: 0, bytes: 0, masViejo: null, motivo: e?.message || "no se pudo leer" };
    }
}
