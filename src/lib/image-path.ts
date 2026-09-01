export const getImagePath = (path: string | null | undefined) => {
    if (!path) return null;
    if (path.startsWith('http')) return path;

    // Normalize: remove leading slash to check prefix
    const cleanPath = path.startsWith('/') ? path.substring(1) : path;

    // Bucket muerto: 'lpr' nunca existio (el real es 'lpr-prod'). Esas imagenes
    // se perdieron -> devolver null para no disparar 404 (el UI muestra placeholder).
    if (cleanPath.startsWith('api/files/lpr/')) {
        return null;
    }

    if (cleanPath.startsWith('api/files/')) {
        return `/${cleanPath}`;
    }

    return `/api/files/${cleanPath}`;
};
