package uy.com.ies.omniaccess.guard

import android.webkit.CookieManager
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import javax.net.ssl.SSLException

/**
 * Las dos preguntas que la app le hace al servidor antes de abrir la consola:
 * ¿es un OmniAccess? (`/api/guardia/servidor`) y ¿este guardia es quien dice? (`/api/guardia/entrar`).
 *
 * Se llaman desde un hilo aparte (nunca desde el hilo de la pantalla). Los mensajes de error están
 * escritos para el guardia, no para un programador: dicen qué revisar.
 */
object Servidor {
    private const val ESPERA_CONEXION_MS = 8_000
    private const val ESPERA_LECTURA_MS = 10_000

    sealed class Respuesta<out T> {
        data class Bien<T>(val valor: T) : Respuesta<T>()
        data class Mal(val mensaje: String, val credencial: Boolean = false) : Respuesta<Nothing>()
    }

    data class DatosServidor(val base: String, val barrio: String?)

    /**
     * Lo que el guardia escribió, como dirección base: con esquema, sin barra final y sin la ruta
     * de la consola si la pegó entera (https://barrio.com.uy/guard → https://barrio.com.uy).
     */
    fun candidatos(escrito: String): List<String> {
        var s = escrito.trim().trimEnd('/')
        s = s.replace(Regex("/(guard|admin|login)(/.*)?$", RegexOption.IGNORE_CASE), "")
        if (s.startsWith("http://", true) || s.startsWith("https://", true)) return listOf(s)
        // Sin esquema: primero https; si no contesta, http (una garita en la red local con IP y puerto).
        return listOf("https://$s", "http://$s")
    }

    fun verificar(escrito: String): Respuesta<DatosServidor> {
        if (escrito.isBlank()) return Respuesta.Mal("Escribí la dirección del servidor.")
        var ultimo: Respuesta.Mal = Respuesta.Mal("No se pudo conectar con el servidor.")
        for (base in candidatos(escrito)) {
            try {
                val c = abrir("$base/api/guardia/servidor", "GET")
                val codigo = c.responseCode
                val cuerpo = leer(c, codigo)
                if (codigo == 404) { ultimo = Respuesta.Mal("Ese servidor contesta, pero no tiene OmniAccess o está desactualizado."); continue }
                if (codigo !in 200..299) { ultimo = Respuesta.Mal("El servidor respondió con un error ($codigo). Probá de nuevo en un rato."); continue }
                val j = JSONObject(cuerpo)
                if (j.optString("producto") != "OmniAccess") { ultimo = Respuesta.Mal("Ese servidor no es un OmniAccess."); continue }
                return Respuesta.Bien(DatosServidor(base, j.optString("barrio").ifBlank { null }))
            } catch (e: SSLException) {
                ultimo = Respuesta.Mal("El certificado de seguridad del servidor no es válido. Usá la dirección https del barrio.")
            } catch (e: UnknownHostException) {
                ultimo = Respuesta.Mal("No existe esa dirección. Revisá que esté bien escrita.")
            } catch (e: SocketTimeoutException) {
                ultimo = Respuesta.Mal("El servidor no contesta. Revisá la conexión a internet o la red del barrio.")
            } catch (e: IOException) {
                ultimo = Respuesta.Mal("No se pudo conectar con el servidor. Revisá la dirección y la conexión.")
            } catch (e: Exception) {
                ultimo = Respuesta.Mal("Ese servidor no es un OmniAccess.")
            }
        }
        return ultimo
    }

    /**
     * Identifica al guardia. Si sale bien, el servidor devuelve la cookie firmada `guardia` y se
     * la pasa al WebView: la consola abre directo, sin volver a pedir el PIN.
     */
    fun entrar(base: String, usuario: String, clave: String): Respuesta<String> {
        return try {
            val c = abrir("$base/api/guardia/entrar", "POST")
            c.setRequestProperty("Content-Type", "application/json")
            c.doOutput = true
            c.outputStream.use { it.write(JSONObject().put("usuario", usuario).put("clave", clave).toString().toByteArray(Charsets.UTF_8)) }
            val codigo = c.responseCode
            val j = runCatching { JSONObject(leer(c, codigo)) }.getOrElse { JSONObject() }
            when {
                codigo == 429 || j.optBoolean("bloqueado") -> Respuesta.Mal("Demasiados intentos con ese usuario. Esperá unos minutos.", credencial = true)
                codigo == 401 || (codigo in 200..299 && !j.optBoolean("ok")) -> Respuesta.Mal("El usuario o el PIN no son correctos.", credencial = true)
                codigo !in 200..299 -> Respuesta.Mal("El servidor respondió con un error ($codigo).")
                else -> {
                    val cookies = CookieManager.getInstance()
                    c.headerFields.filterKeys { it.equals("Set-Cookie", true) }.values.flatten().forEach { cookies.setCookie(base, it) }
                    cookies.flush()
                    Respuesta.Bien(j.optString("nombre", usuario))
                }
            }
        } catch (e: SSLException) {
            Respuesta.Mal("El certificado de seguridad del servidor no es válido.")
        } catch (e: IOException) {
            Respuesta.Mal("No se pudo conectar con el servidor.")
        }
    }

    private fun abrir(url: String, metodo: String): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = metodo
            connectTimeout = ESPERA_CONEXION_MS
            readTimeout = ESPERA_LECTURA_MS
            instanceFollowRedirects = true
            setRequestProperty("Accept", "application/json")
            setRequestProperty("User-Agent", "OmniAccessGuard/${BuildConfig.VERSION_NAME}")
        }

    private fun leer(c: HttpURLConnection, codigo: Int): String =
        (if (codigo >= 400) c.errorStream else c.inputStream)?.bufferedReader()?.use { it.readText() } ?: ""
}
