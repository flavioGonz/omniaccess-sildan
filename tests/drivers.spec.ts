import { test, expect, APIRequestContext } from '@playwright/test';

// Utilidad para simular webhooks de distintos vendors con MACs REALES de la DB
async function simulateWebhook(request: APIRequestContext, vendor: string, data: any) {
    const urls: Record<string, string> = {
        'avicam': 'http://localhost:10000/api/webhooks/avicam',
        'hikvision': 'http://localhost:10000/api/webhooks/hikvision',
        'akuvox': 'http://localhost:10000/api/webhooks/akuvox'
    };

    let url = urls[vendor];
    let body = data;
    let headers = { 'Content-Type': 'application/json' };

    if (vendor === 'akuvox') {
        const params = new URLSearchParams(data);
        url = `${url}?${params.toString()}`;
    }

    return await request.post(url, {
        data: body,
        headers: headers
    });
}

test.describe('Flujo de Eventos Multi-Driver (Real-Time Verification)', () => {
    
    test('debe procesar evento AVICAM y mostrarlo en la UI', async ({ page, request }) => {
        // Bypass identity overlay
        await page.addInitScript(() => {
            window.localStorage.setItem('bitacora_guard_name', 'Test Runner');
        });
        
        await page.goto('/guard-iphone');
        
        // 1. Verificar conexión inicial
        await expect(page.locator('body')).toContainText(/CONECTADO/i, { timeout: 10000 });
        
        const avicamPayload = {
            operator: 'VerifyPush',
            info: {
                DeviceID: '1644117',
                Name: 'Usuario Test Avicam',
                PersonID: '1001',
                VerifyStatus: 1,
                CreateTime: new Date().toISOString()
            }
        };

        const response = await simulateWebhook(request, 'avicam', avicamPayload);
        expect(response.ok()).toBeTruthy();
        
        // 3. Verificar Toast
        await expect(page.getByText(/ROSTRO DETECTADO: Usuario Test Avicam/i)).toBeVisible({ timeout: 20000 });
    });

    test('debe procesar evento AKUVOX y mostrarlo en la UI', async ({ page, request }) => {
        // Bypass identity overlay
        await page.addInitScript(() => {
            window.localStorage.setItem('bitacora_guard_name', 'Test Runner');
        });
        await page.goto('/guard-iphone');
        await expect(page.locator('body')).toContainText(/CONECTADO/i, { timeout: 10000 });

        const akuvoxParams = {
            event: 'face',
            mac: '0C:11:05:29:BB:8A',
            user: 'Persona Akuvox',
            type: 'valid',
            time: Math.floor(Date.now() / 1000)
        };

        const response = await simulateWebhook(request, 'akuvox', akuvoxParams);
        expect(response.ok()).toBeTruthy();

        await expect(page.getByText(/ROSTRO DETECTADO: Persona Akuvox/i)).toBeVisible({ timeout: 20000 });
    });
});
