/**
 * Módulo compartido de Digest Authentication
 * Reemplaza las 5 implementaciones duplicadas en HikvisionDriver, AkuvoxDriver y server.js
 */
import crypto from "crypto";
import axios, { AxiosRequestConfig, Method } from "axios";
import * as https from "https";

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

export interface DigestAuthDevice {
    ip: string;
    username?: string | null;
    password?: string | null;
    authType?: string | null;
}

interface DigestChallenge {
    realm: string;
    nonce: string;
    qop?: string | null;
    opaque?: string | null;
    algorithm?: string;
}

function parseWWWAuthenticate(header: string): DigestChallenge | null {
    const getVal = (key: string): string | null => {
        const match = header.match(new RegExp(`${key}="?([^",]+)"?`));
        return match ? match[1].trim() : null;
    };

    const realm = getVal("realm");
    const nonce = getVal("nonce");
    if (!realm || !nonce) return null;

    return {
        realm,
        nonce,
        qop: getVal("qop"),
        opaque: getVal("opaque"),
        algorithm: getVal("algorithm") || "MD5",
    };
}

function buildDigestHeader(
    method: string,
    uri: string,
    username: string,
    password: string,
    challenge: DigestChallenge
): string {
    const { realm, nonce, qop, opaque, algorithm } = challenge;

    const ha1 = crypto.createHash("md5").update(`${username}:${realm}:${password}`).digest("hex");
    const ha2 = crypto.createHash("md5").update(`${method}:${uri}`).digest("hex");

    const nc = "00000001";
    const cnonce = crypto.randomBytes(8).toString("hex");

    let response: string;
    if (qop === "auth") {
        response = crypto.createHash("md5")
            .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
            .digest("hex");
    } else {
        response = crypto.createHash("md5")
            .update(`${ha1}:${nonce}:${ha2}`)
            .digest("hex");
    }

    let authString = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", algorithm="${algorithm}", response="${response}"`;
    if (opaque) authString += `, opaque="${opaque}"`;
    if (qop) authString += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;

    return authString;
}

/**
 * Ejecuta un request HTTP con soporte automático de Basic y Digest auth.
 * Maneja el challenge-response de Digest de forma transparente.
 */
export async function authenticatedRequest(
    method: Method,
    url: string,
    device: DigestAuthDevice,
    options: {
        data?: any;
        contentType?: string;
        accept?: string;
        responseType?: "json" | "text" | "arraybuffer";
        timeout?: number;
    } = {}
): Promise<any> {
    const username = device.username || "admin";
    const password = device.password || "";
    const host = (device.ip || "").replace(/^https?:\/\//, "");
    const baseURL = `http://${host}`;

    const contentType = options.contentType || "application/json";
    const accept = options.accept || contentType;
    const timeout = options.timeout || 15000;

    const headers: Record<string, string> = {
        "Content-Type": contentType,
        "Accept": accept,
    };

    // Basic auth: add header upfront
    if (device.authType === "BASIC") {
        const token = Buffer.from(`${username}:${password}`).toString("base64");
        headers["Authorization"] = `Basic ${token}`;
    }

    const config: AxiosRequestConfig = {
        method,
        baseURL,
        url,
        data: options.data,
        headers,
        httpsAgent,
        timeout,
        responseType: options.responseType || "json",
    };

    try {
        const response = await axios.request(config);
        return options.responseType === "text" ? response.data : response.data;
    } catch (error: any) {
        // Digest auth: handle 401 challenge
        const authHeader = error.response?.headers?.["www-authenticate"];
        if (
            device.authType === "DIGEST" &&
            error.response?.status === 401 &&
            authHeader
        ) {
            const challenge = parseWWWAuthenticate(authHeader);
            if (!challenge) throw error;

            const digestHeader = buildDigestHeader(method, url, username, password, challenge);

            const retryConfig: AxiosRequestConfig = {
                ...config,
                headers: {
                    ...headers,
                    Authorization: digestHeader,
                },
                timeout: timeout + 5000, // Extra time for retry
            };

            const response = await axios.request(retryConfig);
            return options.responseType === "text" ? response.data : response.data;
        }

        throw error;
    }
}

/**
 * Helper para Basic auth header (usado en requests directos con axios)
 */
export function getBasicAuthHeader(username: string, password: string): Record<string, string> {
    const token = Buffer.from(`${username}:${password}`).toString("base64");
    return { Authorization: `Basic ${token}` };
}

export { parseWWWAuthenticate, buildDigestHeader, httpsAgent };
