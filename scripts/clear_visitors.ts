import axios from 'axios';

// NOTE: This script is intended to be run in an environment with access to the CompareFace server.
// If running locally where the server is not reachable, use the Admin UI instead.

const TARGETS = [
    {
        url: process.env.COMPARE_FACE_URL || "https://compareface.infratec.com.uy",
        key: "d7bdb468-26af-4306-b35d-499e5373ac4a",
        name: "Cloud / Default Env"
    },
    {
        url: "http://192.168.99.57:8000",
        key: "1f78ca0c-8c83-48ad-bc80-e6bfcb136d8d",
        name: "Local Instance (192.168.99.57)"
    }
];

async function clearVisitors() {
    console.log("Starting visitor cleanup process...");

    for (const target of TARGETS) {
        console.log(`\n--- Checking ${target.name} (${target.url}) ---`);
        try {
            // 1. Get all subjects
            const response = await axios.get(`${target.url}/api/v1/recognition/subjects`, {
                headers: { "x-api-key": target.key },
                timeout: 5000
            });

            const subjects = response.data.subjects || [];
            console.log(`Found ${subjects.length} visitor subjects.`);

            if (subjects.length === 0) {
                console.log("No visitors to delete.");
                continue;
            }

            // 2. Delete
            let deletedCount = 0;
            const chunkSize = 5;

            for (let i = 0; i < subjects.length; i += chunkSize) {
                const chunk = subjects.slice(i, i + chunkSize);
                await Promise.all(chunk.map(async (subject: any) => {
                    try {
                        await axios.delete(`${target.url}/api/v1/recognition/subjects/${encodeURIComponent(subject)}`, {
                            headers: { "x-api-key": target.key },
                            timeout: 10000
                        });
                        deletedCount++;
                    } catch (e: any) {
                        console.error(`Failed to delete ${subject}: ${e.message}`);
                    }
                }));
                process.stdout.write(`Deleted ${deletedCount}/${subjects.length}...\r`);
            }
            console.log(`\nFinished clearing ${deletedCount} visitors from ${target.name}.`);

        } catch (error: any) {
            console.error(`Error connecting to ${target.name}:`, error.message);
            if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
                console.error("Network invalid or unreachable.");
            }
        }
    }
    console.log("\nDone.");
}

clearVisitors();
