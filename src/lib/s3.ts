import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { prisma } from "./prisma";

async function getS3Config() {
    try {
        // Try to get from database first
        const [endpoint, accessKey, secretKey, bucketLpr, bucketFace] = await Promise.all([
            prisma.setting.findUnique({ where: { key: "S3_ENDPOINT" } }),
            prisma.setting.findUnique({ where: { key: "S3_ACCESS_KEY" } }),
            prisma.setting.findUnique({ where: { key: "S3_SECRET_KEY" } }),
            prisma.setting.findUnique({ where: { key: "S3_BUCKET_LPR" } }),
            prisma.setting.findUnique({ where: { key: "S3_BUCKET_FACE" } }),
        ]);

        return {
            endpoint: endpoint?.value || process.env.S3_ENDPOINT || "",
            accessKey: accessKey?.value || process.env.S3_ACCESS_KEY || "",
            secretKey: secretKey?.value || process.env.S3_SECRET_KEY || "",
            bucketLpr: bucketLpr?.value || process.env.S3_BUCKET || "lpr-prod",
            bucketFace: bucketFace?.value || "face"
        };
    } catch (e) {
        console.warn("[S3 Config] Error fetching from DB, using fallback:", e);
        return {
            endpoint: process.env.S3_ENDPOINT || "",
            accessKey: process.env.S3_ACCESS_KEY || "",
            secretKey: process.env.S3_SECRET_KEY || "",
            bucketLpr: process.env.S3_BUCKET || "lpr-prod",
            bucketFace: process.env.S3_BUCKET_FACE || "face"
        };
    }
}

/**
 * Manually deletes the oldest objects from a bucket to free up space.
 * This is a safety measure when MinIO lifecycle is failing or slow.
 */
async function recycleOldestObjects(s3Client: S3Client, bucketName: string, count: number = 100) {
    try {
        const listCmd = new ListObjectsV2Command({
            Bucket: bucketName,
            MaxKeys: 1000 // Look at a pool of 1000
        });

        const listRes = await s3Client.send(listCmd);
        if (!listRes.Contents || listRes.Contents.length === 0) {
            return;
        }

        // Sort by LastModified (oldest first)
        const oldest = listRes.Contents
            .sort((a, b) => (a.LastModified?.getTime() || 0) - (b.LastModified?.getTime() || 0))
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
    } catch (error: any) {
        console.error(`[S3-Recycle] ❌ Failed to recycle objects:`, error.message);
    }
}

export async function uploadToS3(
    fileBuffer: Buffer | ArrayBuffer,
    filename: string,
    contentType: string,
    bucketType: "lpr" | "face" | "queue" = "lpr"
) {
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

    let bucketName = bucketType === "face" ? config.bucketFace : config.bucketLpr;
    if (bucketType === "queue") {
        try { const q = await prisma.setting.findUnique({ where: { key: "S3_BUCKET_QUEUE" } }); if (q?.value) bucketName = q.value; } catch {}
    }

    try {
        const upload = new Upload({
            client: s3Client,
            params: {
                Bucket: bucketName,
                Key: filename,
                Body: fileBuffer instanceof ArrayBuffer ? Buffer.from(fileBuffer) : fileBuffer,
                ContentType: contentType,
            },
        });

        await upload.done();
        return `/api/files/${bucketName}/${filename}`;
    } catch (error: any) {
        // Check for "MinIO storage full" error
        if (error.message?.includes("minimum free drive threshold") || error.code === "QuotaExceededException") {
            console.warn(`[S3] 🚨 STORAGE FULL DETECTED. Triggering emergency recycling...`);
            await recycleOldestObjects(s3Client, bucketName, 200);
            
            // Retry once after recycling
            try {
                const retryUpload = new Upload({
                    client: s3Client,
                    params: {
                        Bucket: bucketName,
                        Key: filename,
                        Body: fileBuffer instanceof ArrayBuffer ? Buffer.from(fileBuffer) : fileBuffer,
                        ContentType: contentType,
                    },
                });
                await retryUpload.done();
                return `/api/files/${bucketName}/${filename}`;
            } catch (retryError: any) {
                console.error(`[S3] Retry failed: ${retryError.message}`);
                throw retryError;
            }
        }
        throw error;
    }
}

// Helper to get client for the proxy
export async function getS3Client() {
    const config = await getS3Config();
    return new S3Client({
        endpoint: config.endpoint,
        region: "us-east-1",
        credentials: {
            accessKeyId: config.accessKey,
            secretAccessKey: config.secretKey,
        },
        forcePathStyle: true,
    });
}
