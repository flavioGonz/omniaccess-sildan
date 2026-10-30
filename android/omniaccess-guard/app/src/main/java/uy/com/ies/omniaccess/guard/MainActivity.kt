package uy.com.ies.omniaccess.guard

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.net.http.SslError
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.speech.tts.TextToSpeech
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.updatePadding
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.util.Locale
import kotlin.concurrent.thread
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * La consola de la garita (/guard) dentro de la app, con lo que el navegador no puede: linterna,
 * voz, alarma a todo volumen, NFC para las rondas, hombre caído, pánico con los botones de volumen
 * y el servicio que mantiene todo vivo durante el turno.
 *
 * La página habla con la app por `window.AndroidGuard` (PuenteGuardia) y escucha los avisos de la
 * app en el evento `guardnative` (src/lib/guard-native.ts del servidor). Los nombres de los métodos
 * y de los eventos son los mismos de la APK anterior: la consola no cambia.
 */
class MainActivity : ComponentActivity(), SensorEventListener {
    private lateinit var ajustes: Ajustes
    private lateinit var base: String
    private var web: WebView? = null
    private lateinit var raiz: FrameLayout
    private lateinit var carga: View
    private lateinit var falla: View
    private val principal = Handler(Looper.getMainLooper())

    private var splashListo = false
    private var paginaLista = false
    private var panicoPendiente = false
    private var ultimoAtras = 0L

    private var sensores: SensorManager? = null
    private var camaras: CameraManager? = null
    private var linternaId: String? = null
    private var voz: TextToSpeech? = null
    private var alarma: MediaPlayer? = null
    private var nfc: NfcAdapter? = null
    private var nfcIntento: PendingIntent? = null
    private var nfcPrendido = false

    private val gravedad = FloatArray(3); private val magnetico = FloatArray(3)
    private val rotacion = FloatArray(9); private val orientacion = FloatArray(3)
    private var hayGravedad = false; private var hayMagnetico = false
    private var rumbo = 0f; private var lux = -1f
    private var pasosBase = -1; private var pasos = 0
    private var ultimoEnvioSensores = 0L
    private var golpeEn = 0L; private var quietoDesde = 0L; private var caidoAvisado = false
    private val toquesVolumen = LongArray(TOQUES_PANICO); private var toqueIndice = 0

    private val pedirPermisos = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        if (tiene(Manifest.permission.ACCESS_FINE_LOCATION)) iniciarServicio()
        emitir("permisos", "{}")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        ajustes = Ajustes(this)
        val servidor = ajustes.servidor
        if (!ajustes.completo || servidor == null) {
            startActivity(Intent(this, BienvenidaActivity::class.java))
            finish()
            return
        }
        base = servidor

        // El logo del arranque queda hasta que se renovó la identificación del guardia, y como
        // mucho SPLASH_MAX_MS: después sigue la pantalla de carga propia, que muestra el avance.
        splash.setKeepOnScreenCondition { !splashListo }
        principal.postDelayed({ splashListo = true }, SPLASH_MAX_MS)
        splash.setOnExitAnimationListener { vista ->
            vista.iconView.animate().scaleX(1.25f).scaleY(1.25f).alpha(0f).setDuration(280).setInterpolator(Curvas.ios).start()
            vista.view.animate().alpha(0f).setDuration(320).setInterpolator(Curvas.ios).withEndAction { vista.remove() }.start()
        }

        setContentView(R.layout.activity_main)
        raiz = findViewById(R.id.raiz)
        carga = findViewById(R.id.carga)
        falla = findViewById(R.id.falla)
        findViewById<TextView>(R.id.carga_barrio).text = ajustes.barrio ?: getString(R.string.app_name)
        findViewById<Button>(R.id.falla_reintentar).setOnClickListener { reintentar() }
        findViewById<Button>(R.id.falla_servidor).setOnClickListener { abrirBienvenida(BienvenidaActivity.PASO_SERVIDOR, null) }

        modoGarita()
        crearWebView()
        prepararHardware()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = atras()
        })

        // Se renueva la identificación del guardia en cada apertura (dura 14 h en el servidor):
        // así la consola abre directo, sin volver a pedir el PIN.
        thread {
            val r = Servidor.entrar(base, ajustes.usuario!!, ajustes.clave!!)
            runOnUiThread {
                splashListo = true
                if (r is Servidor.Respuesta.Mal && r.credencial) {
                    abrirBienvenida(BienvenidaActivity.PASO_GUARDIA, r.mensaje)
                } else {
                    // Sin conexión también se intenta: la consola tiene su propio aviso de «sin red».
                    web?.loadUrl("$base/guard")
                }
            }
        }

        pedirPermisosQueFaltan()
        Actualizador.revisar(this, base)
        atenderPanico(intent)
    }

    // ── La consola ──────────────────────────────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun crearWebView() {
        val w = WebView(this)
        w.setBackgroundColor(ContextCompat.getColor(this, R.color.fondo))
        // Fluidez: el WebView pinta con la GPU y prepara lo que está fuera de pantalla, así el
        // scroll no muestra franjas en blanco; sin el resplandor de fin de lista de Android, que en
        // una página que ya tiene su propio scroll se veía como un tirón.
        w.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        w.overScrollMode = View.OVER_SCROLL_NEVER
        w.isVerticalScrollBarEnabled = false
        w.isHorizontalScrollBarEnabled = false
        with(w.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            setGeolocationEnabled(true)
            offscreenPreRaster = true
            useWideViewPort = true
            loadWithOverviewMode = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100
            // Lo que la APK anterior dejaba abierto sin necesitarlo.
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = "$userAgentString OmniAccessGuard/${BuildConfig.VERSION_NAME}"
        }
        // La consola tiene su propio tema oscuro: que Chrome no la oscurezca por su cuenta.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) WebSettingsCompat.setAlgorithmicDarkeningAllowed(w.settings, false)
        CookieManager.getInstance().apply { setAcceptCookie(true); setAcceptThirdPartyCookies(w, false) }
        w.addJavascriptInterface(PuenteGuardia(this), "AndroidGuard")
        w.webViewClient = Cliente()
        w.webChromeClient = Cromo()
        raiz.addView(w, 0, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        web = w
    }

    private fun mismoOrigen(u: Uri?): Boolean {
        val b = Uri.parse(base)
        return u != null && u.scheme == b.scheme && u.host == b.host && u.port == b.port
    }

    private inner class Cliente : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
            if (mismoOrigen(req.url)) return false
            // Fuera del servidor (un mapa, WhatsApp, un teléfono): se abre afuera. La página de otro
            // sitio nunca carga dentro de la app, que es donde vive el puente con el hardware.
            abrirAfuera(req.url.toString())
            return true
        }

        override fun onPageCommitVisible(view: WebView, url: String) { ocultarCarga() }

        override fun onPageFinished(view: WebView, url: String) {
            paginaLista = true
            ocultarCarga()
            emitir("ready", "{\"version\":\"${BuildConfig.VERSION_NAME}\"}")
            if (panicoPendiente) dispararPanico()
        }

        override fun onReceivedError(view: WebView, req: WebResourceRequest, error: WebResourceError) {
            if (!req.isForMainFrame) return
            // En palabras del guardia, no los códigos de Chrome (net::ERR_NAME_NOT_RESOLVED).
            mostrarFalla(when (error.errorCode) {
                ERROR_HOST_LOOKUP -> "No se encuentra el servidor. Revisá que la tablet tenga internet o red del barrio."
                ERROR_CONNECT, ERROR_TIMEOUT -> "El servidor no contesta. Puede estar reiniciándose: probá de nuevo en un minuto."
                ERROR_FAILED_SSL_HANDSHAKE -> "No se pudo establecer una conexión segura con el servidor."
                else -> "Se cortó la conexión con el servidor. Revisá la red de la tablet."
            })
        }

        override fun onReceivedHttpError(view: WebView, req: WebResourceRequest, resp: WebResourceResponse) {
            if (req.isForMainFrame && resp.statusCode >= 500) mostrarFalla("El servidor respondió con un error (${resp.statusCode}). Probá de nuevo en un rato.")
        }

        // Un certificado inválido NO se acepta (la APK anterior aceptaba cualquiera, y Play rechaza eso).
        @SuppressLint("WebViewClientOnReceivedSslError")
        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            handler.cancel()
            mostrarFalla("El certificado de seguridad del servidor no es válido. Pedile a la administración la dirección https correcta.")
        }

        // Si Android mata el proceso que dibuja la página (memoria baja en tablets viejas), la app
        // no se cierra: se arma un WebView nuevo y se vuelve a la consola.
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            raiz.removeView(view); view.destroy(); web = null
            mostrarCarga(); crearWebView(); web?.loadUrl("$base/guard")
            return true
        }
    }

    private inner class Cromo : WebChromeClient() {
        override fun onProgressChanged(view: WebView, progreso: Int) {
            findViewById<ProgressBar>(R.id.carga_barra).setProgress(progreso.coerceAtLeast(8), true)
        }

        /** Cámara y micrófono sólo para la consola del propio servidor, y sólo si el guardia ya los permitió. */
        override fun onPermissionRequest(req: PermissionRequest) {
            runOnUiThread {
                if (!mismoOrigen(req.origin)) { req.deny(); return@runOnUiThread }
                val dar = req.resources.filter {
                    (it == PermissionRequest.RESOURCE_VIDEO_CAPTURE && tiene(Manifest.permission.CAMERA)) ||
                        (it == PermissionRequest.RESOURCE_AUDIO_CAPTURE && tiene(Manifest.permission.RECORD_AUDIO))
                }
                if (dar.isEmpty()) req.deny() else req.grant(dar.toTypedArray())
            }
        }

        override fun onGeolocationPermissionsShowPrompt(origen: String, cb: GeolocationPermissions.Callback) {
            cb.invoke(origen, mismoOrigen(Uri.parse(origen)) && tiene(Manifest.permission.ACCESS_FINE_LOCATION), false)
        }
    }

    private fun ocultarCarga() {
        if (carga.visibility != View.VISIBLE || carga.tag == "saliendo") return
        carga.tag = "saliendo"
        findViewById<View>(R.id.carga_logo).animate().scaleX(1.12f).scaleY(1.12f).setDuration(320).setInterpolator(Curvas.ios).start()
        carga.animate().alpha(0f).setDuration(340).setInterpolator(Curvas.ios).withEndAction {
            carga.visibility = View.GONE; carga.tag = null; carga.alpha = 1f
            findViewById<View>(R.id.carga_logo).apply { scaleX = 1f; scaleY = 1f }
        }.start()
    }

    private fun mostrarCarga() { carga.animate().cancel(); carga.alpha = 1f; carga.tag = null; carga.visibility = View.VISIBLE }

    private fun mostrarFalla(detalle: String) {
        findViewById<TextView>(R.id.falla_detalle).text = detalle
        if (falla.visibility == View.VISIBLE) return
        falla.alpha = 0f; falla.visibility = View.VISIBLE
        falla.animate().alpha(1f).setDuration(260).start()
        carga.visibility = View.GONE
    }

    private fun reintentar() {
        falla.visibility = View.GONE
        mostrarCarga()
        web?.loadUrl("$base/guard")
    }

    private fun abrirBienvenida(paso: Int, aviso: String?) {
        startActivity(Intent(this, BienvenidaActivity::class.java).putExtra(BienvenidaActivity.EXTRA_PASO, paso).putExtra(BienvenidaActivity.EXTRA_AVISO, aviso))
        Curvas.fundido(this)
        finish()
    }

    fun abrirAfuera(url: String) {
        try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        catch (_: Exception) { Toast.makeText(this, "No hay una app para abrir ese enlace", Toast.LENGTH_SHORT).show() }
    }

    /** «Cambiar guardia» desde la consola: se olvida el PIN guardado y se pide el del que entra. */
    fun cambiarGuardia() = runOnUiThread {
        ajustes.olvidarGuardia()
        CookieManager.getInstance().removeAllCookies(null)
        abrirBienvenida(BienvenidaActivity.PASO_GUARDIA, null)
    }

    fun cambiarServidor() = runOnUiThread { abrirBienvenida(BienvenidaActivity.PASO_SERVIDOR, null) }

    /** Avisa a la consola. Mismo evento que la APK anterior: `guardnative`, con `type` y los datos. */
    fun emitir(tipo: String, json: String) {
        val js = "try{window.dispatchEvent(new CustomEvent('guardnative',{detail:Object.assign({type:${JSONObject.quote(tipo)}},$json)}))}catch(e){}"
        runOnUiThread { web?.evaluateJavascript(js, null) }
    }

    // ── Garita: pantalla completa y siempre encendida ───────────────────────────────────────

    private fun modoGarita() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        // Con la pantalla completa, el teclado tapaba los campos de abajo: se deja su lugar.
        ViewCompat.setOnApplyWindowInsetsListener(raiz) { v, insets ->
            v.updatePadding(bottom = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom); insets
        }
    }

    override fun onWindowFocusChanged(conFoco: Boolean) {
        super.onWindowFocusChanged(conFoco)
        if (conFoco) WindowInsetsControllerCompat(window, window.decorView).hide(WindowInsetsCompat.Type.systemBars())
    }

    private fun atras() {
        val w = web
        if (w != null && w.canGoBack()) { w.goBack(); return }
        val ahora = SystemClock.elapsedRealtime()
        if (ahora - ultimoAtras < DOBLE_ATRAS_MS) { finish(); return }
        ultimoAtras = ahora
        Toast.makeText(this, R.string.salir_otra_vez, Toast.LENGTH_SHORT).show()
    }

    // ── Permisos y servicio ─────────────────────────────────────────────────────────────────

    private fun tiene(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    private fun pedirPermisosQueFaltan() {
        val todos = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= 29) todos += Manifest.permission.ACTIVITY_RECOGNITION
        if (Build.VERSION.SDK_INT >= 33) todos += Manifest.permission.POST_NOTIFICATIONS
        val faltan = todos.filterNot { tiene(it) }
        if (faltan.isEmpty()) iniciarServicio() else pedirPermisos.launch(faltan.toTypedArray())
    }

    /** El servicio de turno es de tipo ubicación: Android 14+ no lo deja arrancar sin ese permiso. */
    fun iniciarServicio() {
        if (!tiene(Manifest.permission.ACCESS_FINE_LOCATION) && !tiene(Manifest.permission.ACCESS_COARSE_LOCATION)) return
        try { ContextCompat.startForegroundService(this, Intent(this, ServicioGuardia::class.java)) } catch (_: Exception) { }
    }

    fun detenerServicio() { try { stopService(Intent(this, ServicioGuardia::class.java)) } catch (_: Exception) { } }

    // ── Hardware ────────────────────────────────────────────────────────────────────────────

    private fun prepararHardware() {
        sensores = getSystemService(SensorManager::class.java)
        camaras = getSystemService(CameraManager::class.java)
        linternaId = try {
            camaras?.cameraIdList?.firstOrNull { camaras?.getCameraCharacteristics(it)?.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true }
        } catch (_: Exception) { null }
        voz = TextToSpeech(this) { estado ->
            if (estado == TextToSpeech.SUCCESS) {
                val uy = Locale.forLanguageTag("es-UY")
                if (voz?.setLanguage(uy) ?: TextToSpeech.LANG_NOT_SUPPORTED < 0) voz?.setLanguage(Locale.forLanguageTag("es"))
            }
        }
        nfc = NfcAdapter.getDefaultAdapter(this)
        if (nfc != null) {
            val banderas = if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
            nfcIntento = PendingIntent.getActivity(this, 0, Intent(this, javaClass).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), banderas)
        }
    }

    fun vibrar(ms: Int) {
        val v: Vibrator? = if (Build.VERSION.SDK_INT >= 31) getSystemService(VibratorManager::class.java)?.defaultVibrator
        else @Suppress("DEPRECATION") getSystemService(Vibrator::class.java)
        try { v?.vibrate(VibrationEffect.createOneShot(ms.toLong().coerceIn(1, 5000), VibrationEffect.DEFAULT_AMPLITUDE)) } catch (_: Exception) { }
    }

    fun linterna(prendida: Boolean) { try { linternaId?.let { camaras?.setTorchMode(it, prendida) } } catch (_: Exception) { } }

    fun hablar(texto: String?) { if (!texto.isNullOrBlank()) voz?.speak(texto, TextToSpeech.QUEUE_ADD, null, "guardia") }

    /** La alarma suena por el canal de alarmas al máximo: se oye aunque la tablet esté en silencio. */
    fun sonarAlarma(prendida: Boolean) = runOnUiThread {
        try {
            if (!prendida) { alarma?.run { stop(); release() }; alarma = null; return@runOnUiThread }
            val audio = getSystemService(AudioManager::class.java)
            audio?.setStreamVolume(AudioManager.STREAM_ALARM, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)
            if (alarma == null) {
                val sonido = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM) ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
                alarma = MediaPlayer().apply {
                    setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                    setDataSource(this@MainActivity, sonido); isLooping = true; prepare()
                }
            }
            alarma?.takeIf { !it.isPlaying }?.start()
        } catch (_: Exception) { }
    }

    fun mantenerDespierta(si: Boolean) = runOnUiThread {
        if (si) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    fun bateria(): Int = getSystemService(BatteryManager::class.java)?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)?.takeIf { it >= 0 } ?: -1

    private fun cargando(): Int {
        val b = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return 0
        val s = b.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        return if (s == BatteryManager.BATTERY_STATUS_CHARGING || s == BatteryManager.BATTERY_STATUS_FULL) 1 else 0
    }

    @Suppress("DEPRECATION")
    fun senal(): String = try {
        val wm = applicationContext.getSystemService(android.net.wifi.WifiManager::class.java)
        if (wm != null && wm.isWifiEnabled) android.net.wifi.WifiManager.calculateSignalLevel(wm.connectionInfo.rssi, 5).toString() else "-1"
    } catch (_: Exception) { "-1" }

    fun nfcPrender(si: Boolean) = runOnUiThread { nfcPrendido = si; aplicarNfc() }

    private fun aplicarNfc() {
        try {
            if (nfcPrendido) nfc?.enableForegroundDispatch(this, nfcIntento, null, null) else nfc?.disableForegroundDispatch(this)
        } catch (_: Exception) { }
    }

    fun abrirAjustesApp() {
        try { startActivity(Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) } catch (_: Exception) { }
    }

    fun abrirAccesibilidad() { try { startActivity(Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS)) } catch (_: Exception) { } }

    fun teclado(mostrar: Boolean) = runOnUiThread {
        val w = web ?: return@runOnUiThread
        val imm = getSystemService(InputMethodManager::class.java)
        if (mostrar) { w.requestFocus(); imm?.showSoftInput(w, InputMethodManager.SHOW_IMPLICIT) } else imm?.hideSoftInputFromWindow(w.windowToken, 0)
    }

    // ── Sensores: rumbo, luz, pasos y hombre caído ──────────────────────────────────────────

    override fun onResume() {
        super.onResume()
        listOf(Sensor.TYPE_ACCELEROMETER, Sensor.TYPE_MAGNETIC_FIELD, Sensor.TYPE_LIGHT, Sensor.TYPE_STEP_COUNTER).forEach { tipo ->
            sensores?.getDefaultSensor(tipo)?.let { sensores?.registerListener(this, it, SensorManager.SENSOR_DELAY_UI) }
        }
        aplicarNfc()
        web?.onResume()
    }

    override fun onPause() {
        super.onPause()
        sensores?.unregisterListener(this)
        try { nfc?.disableForegroundDispatch(this) } catch (_: Exception) { }
        // El WebView NO se pausa: la consola tiene que seguir recibiendo avisos con la pantalla apagada.
    }

    override fun onSensorChanged(e: SensorEvent) {
        when (e.sensor.type) {
            Sensor.TYPE_ACCELEROMETER -> { System.arraycopy(e.values, 0, gravedad, 0, 3); hayGravedad = true; hombreCaido(e.values) }
            Sensor.TYPE_MAGNETIC_FIELD -> { System.arraycopy(e.values, 0, magnetico, 0, 3); hayMagnetico = true }
            Sensor.TYPE_LIGHT -> lux = e.values[0]
            Sensor.TYPE_STEP_COUNTER -> { val total = e.values[0].toInt(); if (pasosBase < 0) pasosBase = total; pasos = total - pasosBase }
        }
        if (hayGravedad && hayMagnetico && SensorManager.getRotationMatrix(rotacion, null, gravedad, magnetico)) {
            SensorManager.getOrientation(rotacion, orientacion)
            rumbo = ((Math.toDegrees(orientacion[0].toDouble()) + 360) % 360).toFloat()
        }
        val ahora = SystemClock.elapsedRealtime()
        if (ahora - ultimoEnvioSensores > SENSORES_CADA_MS) {
            ultimoEnvioSensores = ahora
            emitir("sensors", "{\"heading\":${rumbo.roundToInt()},\"lux\":${if (lux < 0) -1 else lux.roundToInt()},\"steps\":$pasos,\"battery\":${bateria()},\"charging\":${cargando()},\"signal\":${senal()}}")
        }
    }

    /** Un golpe fuerte seguido de quietud: el guardia pudo haberse caído. Los mismos umbrales que la APK anterior. */
    private fun hombreCaido(a: FloatArray) {
        val g = sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2].toDouble())
        val ahora = SystemClock.elapsedRealtime()
        if (g > GOLPE_MS2) { golpeEn = ahora; quietoDesde = 0; caidoAvisado = false }
        if (golpeEn <= 0 || ahora - golpeEn >= VENTANA_CAIDA_MS) return
        if (abs(g - SensorManager.GRAVITY_EARTH) >= QUIETO_TOLERANCIA) { quietoDesde = 0; return }
        if (quietoDesde == 0L) { quietoDesde = ahora; return }
        if (!caidoAvisado && ahora - quietoDesde > QUIETO_MS) { caidoAvisado = true; emitir("mandown", "{\"mag\":${g.roundToInt()}}") }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    // ── Pánico: tres toques al volumen y NFC ────────────────────────────────────────────────

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
            toquesVolumen[toqueIndice % TOQUES_PANICO] = SystemClock.elapsedRealtime()
            toqueIndice++
            if (toqueIndice >= TOQUES_PANICO && toquesVolumen.max() - toquesVolumen.min() < VENTANA_PANICO_MS) {
                toqueIndice = 0; toquesVolumen.fill(0)
                dispararPanico()
                return true
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        atenderPanico(intent)
        val tag: Tag? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(NfcAdapter.EXTRA_TAG, Tag::class.java) else @Suppress("DEPRECATION") intent.getParcelableExtra(NfcAdapter.EXTRA_TAG)
        tag?.id?.let { id ->
            emitir("nfc", "{\"id\":\"${id.joinToString("") { "%02X".format(it) }}\"}")
            vibrar(120)
        }
    }

    private fun atenderPanico(i: Intent?) {
        if (i?.action == accionPanico(this)) { panicoPendiente = true; if (paginaLista) dispararPanico() }
    }

    private fun dispararPanico() {
        panicoPendiente = false
        emitir("volumepanic", "{}")
        vibrar(300)
    }

    override fun onDestroy() {
        sonarAlarma(false)
        voz?.run { stop(); shutdown() }
        web?.run { (parent as? FrameLayout)?.removeView(this); destroy() }
        web = null
        super.onDestroy()
    }

    companion object {
        /** Lo más que se queda el logo del arranque antes de pasar a la pantalla de carga propia. */
        private const val SPLASH_MAX_MS = 1_200L
        private const val DOBLE_ATRAS_MS = 1_500L
        private const val SENSORES_CADA_MS = 3_000L
        private const val TOQUES_PANICO = 3
        private const val VENTANA_PANICO_MS = 2_000L
        private const val GOLPE_MS2 = 28.0
        private const val VENTANA_CAIDA_MS = 8_000L
        private const val QUIETO_TOLERANCIA = 1.6
        private const val QUIETO_MS = 3_500L

        fun accionPanico(c: android.content.Context) = "${c.packageName}.PANICO"
    }
}
