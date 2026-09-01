import { test, expect } from '@playwright/test';

test.describe('Autenticación', () => {
  test('debe cargar la página de login correctamente', async ({ page }) => {
    await page.goto('/login');
    
    // Verificar que el título de la marca esté presente
    await expect(page.locator('h1')).toContainText('OMNI');
    await expect(page.locator('h1')).toContainText('ACCESS');
    
    // Verificar que el formulario de login sea visible
    await expect(page.getByRole('heading', { name: 'Bienvenido de nuevo' })).toBeVisible();
    await expect(page.locator('input[name="username"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });

  test('debe mostrar error con credenciales inválidas', async ({ page }) => {
    await page.goto('/login');
    
    await page.locator('input[name="username"]').fill('usuario_no_existe');
    await page.locator('input[name="password"]').fill('password_incorrecto');
    
    await page.getByRole('button', { name: /Acceder al sistema/i }).click();
    
    // Esperar mensaje de error
    // El mensaje de error aparece en un motion.div con AlertCircle
    await expect(page.locator('p.text-red-400')).toBeVisible();
  });
});

test.describe('PWA Guard Console', () => {
    test.use({ viewport: { width: 390, height: 844 } }); // Simular iPhone 14
    
    test('debe cargar la consola de guardia (o redirigir a login si no hay sesión)', async ({ page }) => {
        await page.goto('/guard-iphone');
        
        // Si no hay sesión, debería estar en /login
        const url = page.url();
        if (url.includes('/login')) {
            await expect(page.getByRole('heading', { name: 'Bienvenido de nuevo' })).toBeVisible();
        } else {
            // Si carga la consola, verificar elementos clave
            await expect(page.locator('nav')).toBeVisible();
        }
    });
});
