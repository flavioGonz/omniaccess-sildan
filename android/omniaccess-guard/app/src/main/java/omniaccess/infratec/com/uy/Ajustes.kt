package omniaccess.infratec.com.uy

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Lo que la app recuerda en este equipo: el servidor, el usuario del guardia y su PIN.
 *
 * El PIN se guarda cifrado con una clave del almacén de Android (AndroidKeyStore), que no sale
 * del equipo ni se copia en respaldos (allowBackup=false). Se guarda para volver a identificar
 * al guardia solo cuando vence su identificación (14 h): la tablet de garita no puede quedar
 * pidiendo el PIN a las 3 de la mañana. «Cambiar servidor» lo borra todo.
 */
class Ajustes(contexto: Context) {
    private val prefs = contexto.getSharedPreferences(ARCHIVO, Context.MODE_PRIVATE)

    var servidor: String?
        get() = prefs.getString(SERVIDOR, null)
        set(v) = prefs.edit().putString(SERVIDOR, v).apply()
    var barrio: String?
        get() = prefs.getString(BARRIO, null)
        set(v) = prefs.edit().putString(BARRIO, v).apply()
    var usuario: String?
        get() = prefs.getString(USUARIO, null)
        set(v) = prefs.edit().putString(USUARIO, v).apply()
    var clave: String?
        get() = prefs.getString(CLAVE, null)?.let { descifrar(it) }
        set(v) = prefs.edit().putString(CLAVE, v?.let { cifrar(it) }).apply()

    val completo: Boolean get() = !servidor.isNullOrBlank() && !usuario.isNullOrBlank() && clave != null

    fun olvidarGuardia() = prefs.edit().remove(USUARIO).remove(CLAVE).apply()
    fun olvidarTodo() = prefs.edit().clear().apply()

    private fun llave(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }

    private fun cifrar(texto: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, llave()) }
        val datos = c.doFinal(texto.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(c.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(datos, Base64.NO_WRAP)
    }

    /** null si no se puede descifrar (por ejemplo, si se borró la clave del almacén): se vuelve a pedir. */
    private fun descifrar(guardado: String): String? = try {
        val (iv, datos) = guardado.split(":", limit = 2).map { Base64.decode(it, Base64.NO_WRAP) }
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, llave(), GCMParameterSpec(128, iv)) }
        String(c.doFinal(datos), Charsets.UTF_8)
    } catch (_: Exception) { null }

    companion object {
        private const val ARCHIVO = "guardia"
        private const val SERVIDOR = "servidor"
        private const val BARRIO = "barrio"
        private const val USUARIO = "usuario"
        private const val CLAVE = "clave"
        private const val ALIAS = "omniaccess-guard-clave"
    }
}
