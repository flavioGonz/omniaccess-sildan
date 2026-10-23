const { S3Client, CreateBucketCommand, ListObjectsV2Command, DeleteObjectsCommand, GetBucketLifecycleConfigurationCommand, PutBucketLifecycleConfigurationCommand, HeadBucketCommand } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

/**
 * Las fotos de las alarmas de central (Alarm Hub) van a su propio bucket (23/10, Nico: «crear su
 * bucket para separar las fotos capturadas de confirmaciones de robo, etc.; cuidá muy bien las
 * retenciones para que no se nos llene el disco»). Iban a `intrusion`, mezcladas con las capturas
 * de las cámaras. Separadas, cada una tiene su retención y se ve cuánto ocupa cada cosa.
 */
const BUCKET_ALARMAS = "alarmas";

async function getS3Config() {
    try {
        const [endpoint, accessKey, secretKey, bucketLpr, bucketFace] = await Promise.all([
            prisma.setting.findUnique({ where: { key: "S3_ENDPOINT" } }),
            prisma.setting.findUnique({ where: { key: "S3_ACCESS_KEY" } }),
            prisma.setting.findUnique({ where: { key: "S3_SECRET_KEY" } }),
            prisma.setting.findUnique({ where: { key: "S3_BUCKET_LPR" } }),
            prisma.setting.findUnique({ where: { key: "S3_BUCKET_FACE" } }),
        ]);
        let bucketIntrusion = "intrusion";
        try { const bi = await prisma.setting.findUnique({ where: { key: "S3_BUCKET_INTRUSION" } }); bucketIntrusion = bi?.value || process.env.S3_BUCKET_INTRUSION || "intrusion"; } catch {}
        let bucketAlarmas = BUCKET_ALARMAS;
        try { const ba = await prisma.setting.findUnique({ where: { key: "S3_BUCKET_ALARMAS" } }); bucketAlarmas = ba?.value || process.env.S3_BUCKET_ALARMAS || BUCKET_ALARMAS; } catch {}

        return {
            endpoint: endpoint?.value || process.env.S3_ENDPOINT ,
            accessKey: accessKey?.value || process.env.S3_ACCESS_KEY,
            secretKey: secretKey?.value || process.env.S3_SECRET_KEY,
            bucketLpr: bucketLpr?.value || process.env.S3_BUCKET || "lpr-prod",
            bucketFace: bucketFace?.value || "face",
            bucketIntrusion,
            bucketAlarmas,
        };
    } catch (e) {
        console.warn("[S3 Config] Error fetching from DB, using ENV:", e.message);
        return {
            endpoint: process.env.S3_ENDPOINT ,
            accessKey: process.env.S3_ACCESS_KEY,
            secretKey: process.env.S3_SECRET_KEY,
            bucketLpr: process.env.S3_BUCKET || "lpr-prod",
            bucketFace: "face",
            bucketIntrusion: process.env.S3_BUCKET_INTRUSION || "intrusion",
            bucketAlarmas: process.env.S3_BUCKET_ALARMAS || BUCKET_ALARMAS,
        };
    }
}

/**
 * Manually deletes the oldest objects from a bucket to free up space.
 */
async function recycleOldestObjects(s3Client, bucketName, count = 100) {
    console.log(`[S3-Recycle] ⚠️ Space low. Attempting to recycle oldest ${count} objects from ${bucketName}...`);
    try {
        const listCmd = new ListObjectsV2Command({
            Bucket: bucketName,
            MaxKeys: 1000
        });

        const listRes = await s3Client.send(listCmd);
        if (!listRes.Contents || listRes.Contents.length === 0) return;

        const oldest = listRes.Contents
            .sort((a, b) => new Date(a.LastModified) - new Date(b.LastModified))
            .slice(0, count);

        if (oldest.length === 0) return;

        const deleteCmd = new DeleteObjectsCommand({
            Bucket: bucketName,
            Delete: {
                Objects: oldest.map(obj => ({ Key: obj.Key })),
                Quiet: true
            }
        });

        await s3Client.send(deleteCmd);
        console.log(`[S3-Recycle] ✅ Successfully deleted ${oldest.length} oldest objects from ${bucketName}.`);
    } catch (error) {
        console.error(`[S3-Recycle] ❌ Failed to recycle objects:`, error.message);
    }
}

async function uploadToS3(fileBuffer, filename, mimeType, bucketType = "lpr") {
    const config = await getS3Config();

    const s3Client = new S3Client({
        endpoint: config.endpoint,
        region: "us-east-1",
        credentials: {
            accessKeyId: config.accessKey,
            secretAccessKey: config.secretKey,
        },
        forcePathStyle: true,
    });

    const bucketName = bucketType === "lpr" ? config.bucketLpr : bucketType === "intrusion" ? config.bucketIntrusion : bucketType === "alarmas" ? config.bucketAlarmas : config.bucketFace;

    try {
        console.log(`[S3] Uploading: ${filename} to ${bucketName}`);
        const upload = new Upload({
            client: s3Client,
            params: {
                Bucket: bucketName,
                Key: filename,
                Body: fileBuffer,
                ContentType: mimeType,
            },
        });

        await upload.done();
        return `/api/files/${bucketName}/${filename}`;
    } catch (error) {
        // El bucket no existe (una instalación nueva, o un bucket que sólo usa un módulo,
        // como `intrusion`): se crea y se reintenta una vez. El 6/10 en San Nicolás las
        // capturas de intrusión "se subían" a un bucket inexistente y nunca aparecían.
        if (error.name === "NoSuchBucket" || error.Code === "NoSuchBucket" || /NoSuchBucket/.test(String(error.message))) {
            try {
                await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
                console.log(`[S3] bucket '${bucketName}' no existía: creado`);
                const retry = new Upload({ client: s3Client, params: { Bucket: bucketName, Key: filename, Body: fileBuffer, ContentType: mimeType } });
                await retry.done();
                return `/api/files/${bucketName}/${filename}`;
            } catch (e2) { console.error(`[S3] no se pudo crear el bucket '${bucketName}': ${e2.message}`); throw e2; }
        }
        if (error.message?.includes("minimum free drive threshold") || error.code === "QuotaExceededException") {
            console.warn(`[S3] 🚨 STORAGE FULL. Triggering emergency recycling...`);
            await recycleOldestObjects(s3Client, bucketName, 200);
            
            try {
                const retryUpload = new Upload({
                    client: s3Client,
                    params: { Bucket: bucketName, Key: filename, Body: fileBuffer, ContentType: mimeType },
                });
                await retryUpload.done();
                return `/api/files/${bucketName}/${filename}`;
            } catch (retryError) {
                console.error(`[S3] Retry failed: ${retryError.message}`);
                throw retryError;
            }
        }
        console.error(`[S3] Upload failed for ${filename}:`, error.message);
        throw error;
    }
}

// ── Retención ───────────────────────────────────────────────────────────────────────────────
//
// Dos topes, porque cada uno falla distinto:
//  · por DÍAS, con la regla de ciclo de vida del bucket: la aplica MinIO solo, aunque el proceso
//    que sube esté caído. Es el tope normal.
//  · por TAMAÑO, revisado por quien sube: una central que se queda en bucle manda cientos de
//    alarmas en una noche y los días no la frenan. Pasado el tope se borra lo más viejo hasta
//    quedar en el 90 %.
// Sólo para buckets que son SÓLO capturas de eventos: una regla sin prefijo se lleva todo lo del
// bucket (por eso no se aplica a `lpr` ni a `face`, que también guardan fotos de personas, de
// equipos y mapas, ni a `objetos`, que guarda el entrenamiento).

/** El cliente de S3 con la configuración guardada. */
async function clienteS3() {
    const c = await getS3Config();
    return { config: c, s3: new S3Client({ endpoint: c.endpoint, region: "us-east-1", credentials: { accessKeyId: c.accessKey, secretAccessKey: c.secretKey }, forcePathStyle: true }) };
}

/** El nombre real del bucket de un tipo. */
async function bucketDe(tipo) {
    const c = await getS3Config();
    return tipo === "lpr" ? c.bucketLpr : tipo === "intrusion" ? c.bucketIntrusion : tipo === "alarmas" ? c.bucketAlarmas : c.bucketFace;
}

/** Los días de la regla de ciclo de vida del bucket (0 = no tiene). */
async function diasDeRetencion(s3, bucket) {
    try {
        const r = await s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }));
        return (r.Rules || []).filter((x) => x.Status === "Enabled" && x.Expiration && x.Expiration.Days).map((x) => x.Expiration.Days).sort((a, b) => a - b)[0] || 0;
    } catch (e) {
        if (e.name === "NoSuchLifecycleConfiguration" || /NoSuchLifecycle/.test(String(e.message))) return 0;
        throw e;
    }
}

/**
 * Que el bucket exista y borre lo que tiene más de `dias`. Si ya tiene esa regla no toca nada.
 * `soloSiFalta`: no cambia una regla que alguien puso a mano (sólo pone una si no hay).
 * @returns {Promise<{ bucket: string, dias: number, antes: number, cambio: boolean, creado: boolean }>}
 */
async function asegurarRetencion(tipo, dias, { soloSiFalta = false } = {}) {
    const { s3 } = await clienteS3();
    const bucket = await bucketDe(tipo);
    let creado = false;
    try { await s3.send(new HeadBucketCommand({ Bucket: bucket })); } catch (e) {
        if (e.$metadata?.httpStatusCode === 404 || e.name === "NotFound" || e.name === "NoSuchBucket") { await s3.send(new CreateBucketCommand({ Bucket: bucket })); creado = true; } else throw e;
    }
    const antes = await diasDeRetencion(s3, bucket);
    const quiero = Math.max(1, Math.round(Number(dias) || 0));
    if (antes === quiero || (soloSiFalta && antes > 0)) return { bucket, dias: antes || quiero, antes, cambio: false, creado };
    await s3.send(new PutBucketLifecycleConfigurationCommand({
        Bucket: bucket,
        LifecycleConfiguration: { Rules: [{ ID: `RetentionRule-${bucket}`, Status: "Enabled", Filter: { Prefix: "" }, Expiration: { Days: quiero } }] },
    }));
    return { bucket, dias: quiero, antes, cambio: true, creado };
}

/** Lo que hay en el bucket: cuántos, cuánto y el más viejo. */
async function medirBucket(s3, bucket) {
    let n = 0, bytes = 0, viejo = null, tok;
    const objetos = [];
    do {
        const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: tok }));
        for (const o of r.Contents || []) { n++; bytes += o.Size || 0; objetos.push({ Key: o.Key, t: new Date(o.LastModified).getTime(), s: o.Size || 0 }); if (!viejo || o.LastModified < viejo) viejo = o.LastModified; }
        tok = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (tok);
    return { n, bytes, viejo: viejo ? new Date(viejo).toISOString() : null, objetos };
}

/**
 * Si el bucket pasa de `topeBytes`, borra lo más viejo hasta quedar en el 90 % del tope.
 * @returns {Promise<{ bucket: string, n: number, bytes: number, borrados: number, liberados: number }>}
 */
async function podarPorTamano(tipo, topeBytes) {
    const { s3 } = await clienteS3();
    const bucket = await bucketDe(tipo);
    const m = await medirBucket(s3, bucket).catch(() => null);
    if (!m || !topeBytes || m.bytes <= topeBytes) return { bucket, n: m?.n || 0, bytes: m?.bytes || 0, borrados: 0, liberados: 0 };
    const meta = topeBytes * 0.9;
    const viejos = m.objetos.sort((a, b) => a.t - b.t);
    const borrar = [];
    let resto = m.bytes;
    for (const o of viejos) { if (resto <= meta) break; borrar.push({ Key: o.Key }); resto -= o.s; }
    for (let i = 0; i < borrar.length; i += 1000) await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: borrar.slice(i, i + 1000), Quiet: true } }));
    return { bucket, n: m.n - borrar.length, bytes: resto, borrados: borrar.length, liberados: m.bytes - resto };
}

module.exports = { uploadToS3, asegurarRetencion, podarPorTamano, medirBucket, clienteS3, bucketDe, diasDeRetencion, BUCKET_ALARMAS };
