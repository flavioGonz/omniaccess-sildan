package uy.com.ies.omniaccess.guard

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.Toast
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Sólo para las tablets instaladas a mano: si el servidor publica una versión más nueva
 * (/api/apk/version), se baja y se ofrece instalarla. A diferencia de la APK anterior, la descarga
 * valida el certificado del servidor como cualquier conexión: no se instala nada que haya podido
 * cambiar alguien en el medio.
 */
object Actualizador {
    fun revisar(a: Activity, base: String) {
        thread {
            try {
                val info = JSONObject(abrir("$base/api/apk/version").inputStream.bufferedReader().use { it.readText() })
                if (info.optInt("versionCode", 0) <= BuildConfig.VERSION_CODE) return@thread
                if (Build.VERSION.SDK_INT >= 26 && !a.packageManager.canRequestPackageInstalls()) {
                    a.runOnUiThread {
                        Toast.makeText(a, "Hay una versión nueva: permití instalar apps de esta fuente", Toast.LENGTH_LONG).show()
                        a.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${a.packageName}")))
                    }
                    return@thread
                }
                val carpeta = File(a.cacheDir, "actualizacion").apply { mkdirs() }
                val destino = File(carpeta, "omniaccess-guard.apk")
                abrir("$base/api/apk").inputStream.use { entrada -> destino.outputStream().use { entrada.copyTo(it) } }
                val uri = FileProvider.getUriForFile(a, "${a.packageName}.archivos", destino)
                a.runOnUiThread {
                    Toast.makeText(a, R.string.actualizando, Toast.LENGTH_SHORT).show()
                    a.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
                }
            } catch (_: Exception) { /* sin red o sin versión nueva: se revisa en la próxima apertura */ }
        }
    }

    private fun abrir(url: String) = (URL(url).openConnection() as HttpURLConnection).apply { connectTimeout = 8_000; readTimeout = 60_000 }
}
