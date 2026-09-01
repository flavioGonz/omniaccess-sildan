const { S3Client } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function getS3Config() {
    try {
        const [endpoint, accessKey, secretKey, bucketLpr, bucketFace] = await Promise.all([
            prisma.setting.findUnique({ where: { key: "S3_ENDPOINT" } }),
            prisma.setting.findUnique({ where: { key: "S3_ACCESS_KEY" } }),
            prisma.setting.findUnique({ where: { key: "S3_SECRET_KEY" } }),
            prisma.setting.findUnique({ where: { key: "S3_BUCKET_LPR" } }),
            prisma.setting.findUnique({ where: { key: "S3_BUCKET_FACE" } }),
        ]);

        return {
            endpoint: endpoint?.value || process.env.S3_ENDPOINT || "http://192.168.99.108:9000",
            accessKey: accessKey?.value || process.env.S3_ACCESS_KEY || "root",
            secretKey: secretKey?.value || process.env.S3_SECRET_KEY || "flavio20",
            bucketLpr: bucketLpr?.value || process.env.S3_BUCKET || "lpr",
            bucketFace: bucketFace?.value || "face"
        };
    } catch (e) {
        console.warn("[S3 Config] Error fetching from DB, using ENV:", e.message);
        return {
            endpoint: process.env.S3_ENDPOINT || "http://192.168.99.108:9000",
            accessKey: process.env.S3_ACCESS_KEY || "root",
            secretKey: process.env.S3_SECRET_KEY || "flavio20",
            bucketLpr: process.env.S3_BUCKET || "lpr",
            bucketFace: "face"
        };
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

    const bucketName = bucketType === "lpr" ? config.bucketLpr : config.bucketFace;

    try {
        console.log(`[S3] Uploading: ${filename} to ${bucketName} (${config.endpoint})`);
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
        console.error(`[S3] Upload failed for ${filename}:`, error.message);
        throw error;
    }
}

module.exports = { uploadToS3 };
