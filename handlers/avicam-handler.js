const { XMLParser } = require("fast-xml-parser");
const { uploadToS3 } = require("../lib-s3");
const {
    isDuplicate, addDebugLog, isValidImage,
    formatEventDate, generateId, parseMultipart,
} = require("./shared");

/**
 * Handle Avicam LPR webhooks.
 */
const handleAvicamWebhook = async (req, res, logPrefix, deps) => {
    const { prisma, io, sendPushToAll, adoptDevice } = deps;
    try {
        let body = {};
        if (req.method === 'POST') {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const data = Buffer.concat(chunks).toString();
            try {
                body = JSON.parse(data);
            } catch (e) {
                console.warn(`${logPrefix} Avicam body is not JSON`);
            }
        }

        const macAddress = body.info?.DeviceID || body.mac || body.SN || body.SerialNumber;
        const eventType = body.operator || 'FACE_DETECTION';
        
        const allDevices = await prisma.device.findMany({ where: { brand: 'AVICAM' } });
        const normalizeMac = (m) => (m ? String(m).replace(/[:-\s]/g, "").toUpperCase() : null);
        const cleanIncomingMac = normalizeMac(macAddress);
        let device = allDevices.find(d => normalizeMac(d.mac) === cleanIncomingMac);

        if (!device) {
        }

        if (!device) {
            const remoteIp = req.socket.remoteAddress;
            const cleanRemoteIp = remoteIp ? remoteIp.replace(/^.*:/, '') : null;
            if (cleanRemoteIp) {
                device = allDevices.find(d => d.ip === cleanRemoteIp || d.ip.includes(cleanRemoteIp));
            }
        }

        if (!device) {
            device = await adoptDevice(macAddress, req.socket.remoteAddress, 'AVICAM', 'FACE_TERMINAL');
        }

        if (device) {
            await prisma.device.update({
                where: { id: device.id },
                data: { lastOnlinePush: new Date() }
            }).catch(() => { });
        }

        // --- NEW: Process Events and Create History ---
        if (body.operator === 'VerifyPush' || body.operator === 'FacePicPush') {
            const info = body.info || {};
            const personName = info.Name || body.data?.Name || 'Desconocido';
            const personId = info.PersonID || body.data?.PersonId;
            
            // Extract image (can be direct string or inside array)
            let imagePath = null;
            let rawImage = null;
            
            if (typeof body.SanpPic === 'string' && body.SanpPic.length > 100) {
                rawImage = body.SanpPic;
            } else if (Array.isArray(body.SanpPic) && body.SanpPic.length > 0) {
                rawImage = body.SanpPic[0].szPicData || body.SanpPic[0].szPicData1;
            } else if (body.data?.SanpPic) {
                rawImage = typeof body.data.SanpPic === 'string' ? body.data.SanpPic : body.data.SanpPic[0]?.szPicData;
            }

            if (rawImage && typeof rawImage === 'string') {
                try {
                    // Limpiar prefijo data:image si existe
                    const cleanBase64 = rawImage.replace(/^data:image\/\w+;base64,/, "");
                    const buffer = Buffer.from(cleanBase64, 'base64');
                    
                    const filename = `av-${device?.id || 'unknown'}-${Date.now()}.jpg`;
                    
                    // Wrap upload in a timeout to prevent hanging the whole request
                    const uploadPromise = uploadToS3(buffer, filename, "image/jpeg", 'face');
                    const timeoutPromise = new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('S3 Upload Timeout')), 5000)
                    );
                    
                    imagePath = await Promise.race([uploadPromise, timeoutPromise]);
                } catch (imgErr) {
                    console.error(`${logPrefix} [Avicam] Image upload failed or timed out:`, imgErr.message);
                }
            }

            // Clean body for DB (remove huge image)
            const bodyForDb = { ...body };
            if (bodyForDb.SanpPic) bodyForDb.SanpPic = "[STRIPIED_IMAGE_DATA]";
            if (bodyForDb.data?.SanpPic) bodyForDb.data.SanpPic = "[STRIPIED_IMAGE_DATA]";

            // Try to find user in DB
            let userId = null;
            if (personName && personName !== 'Desconocido') {
                try {
                    const user = await prisma.user.findFirst({
                        where: {
                            OR: [
                                { name: { contains: personName, mode: 'insensitive' } },
                                { credentials: { some: { value: String(personId) } } }
                            ]
                        }
                    });
                    if (user) userId = user.id;
                } catch (userErr) {
                    console.error(`${logPrefix} [Avicam] User search error:`, userErr.message);
                }
            }

            // Format details as a Key:Value string for the UI to parse easily
            const detailsStr = `Modo: Rostro, Rostro: ${personName}, ID: ${personId}, Sim: ${info.Similarity1 || body.data?.Similarity || 0}%`;

            // Create AccessEvent record
            let eventData = null;
            try {
                // Timezone Correction: Avicam sends local time (UTC-3). Convert to UTC for server.
                let eventTime = info.CreateTime ? new Date(info.CreateTime) : new Date();
                if (info.CreateTime && !info.CreateTime.includes('Z') && !info.CreateTime.includes('+')) {
                    // It's a local string. Add 3 hours to match UTC server.
                    eventTime = new Date(eventTime.getTime() + (3 * 60 * 60 * 1000));
                }

                eventData = {
                    timestamp: eventTime,
                    accessType: 'FACE',
                    deviceId: device?.id || null,
                    userId: userId || null,
                    direction: device?.direction || 'ENTRY',
                    location: device?.location || 'Terminal Avicam',
                    decision: info.VerifyStatus === 1 ? 'GRANT' : 'DENY',
                    details: detailsStr,
                    imagePath: imagePath,
                    snapshotPath: imagePath
                };
                
                const event = await prisma.accessEvent.create({ data: eventData });
                
                // Emit event for real-time dashboards (Underscore for UI compatibility)
                if (global.io) {
                    // Enrich for UI components that expect joined relations
                    const enrichedEvent = {
                        ...event,
                        device: device,
                        user: {
                            name: personName,
                            cara: imagePath,
                            unit: null
                        },
                        deviceName: device?.name,
                        userName: personName,
                        brand: 'AVICAM'
                    };
                    io.emit("access_event", enrichedEvent);
                }
            } catch (dbErr) {
                console.error(`${logPrefix} [Avicam] DB ERROR!!!!`);
                console.error(`${logPrefix} [Avicam] Stack:`, dbErr.stack);
                console.error(`${logPrefix} [Avicam] Code:`, dbErr.code);
            }
        }

        addDebugLog({
            id: Date.now().toString(),
            timestamp: new Date(),
            source: 'avicam',
            method: req.method,
            url: req.url,
            params: body,
            deviceName: device?.name || 'Avicam Desconocido',
            deviceMac: macAddress,
            credentialValue: body.info?.Name || body.name || body.personName || eventType
        });

        if (global.io) {
            io.emit("webhook-event", {
                type: "AVICAM",
                vendor: "AVICAM",
                device: device?.name || "Avicam Device",
                eventType: eventType,
                timestamp: new Date().toISOString()
            });
        }

        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
    } catch (error) {
        console.error(`${logPrefix} Avicam Handler Error:`, error);
        res.writeHead(500);
        res.end("Error");
    }
};


module.exports = { handleAvicamWebhook };
