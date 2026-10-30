package omniaccess.infratec.com.uy

import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import kotlin.concurrent.thread

/**
 * Primera apertura: el servidor y después el guardia. También se llega acá con «Cambiar servidor»
 * o si el PIN guardado dejó de servir (EXTRA_PASO = PASO_GUARDIA, con el motivo en EXTRA_AVISO).
 */
class BienvenidaActivity : ComponentActivity() {
    private lateinit var ajustes: Ajustes
    private lateinit var pasoServidor: LinearLayout
    private lateinit var pasoGuardia: LinearLayout
    private var base: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_bienvenida)
        ajustes = Ajustes(this)

        // En una tablet el formulario no se estira de borde a borde: una columna cómoda en el medio.
        val columna = findViewById<View>(R.id.columna)
        val maximo = resources.getDimensionPixelSize(R.dimen.columna_max)
        columna.post { if (columna.width > maximo) columna.layoutParams = columna.layoutParams.apply { width = maximo } }
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.raiz)) { v, insets ->
            val b = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            v.updatePadding(top = b.top, bottom = b.bottom); insets
        }

        pasoServidor = findViewById(R.id.paso_servidor)
        pasoGuardia = findViewById(R.id.paso_guardia)
        findViewById<TextView>(R.id.version).text = getString(R.string.version_app, BuildConfig.VERSION_NAME)

        val servidor = findViewById<EditText>(R.id.servidor)
        servidor.setText(ajustes.servidor?.removePrefix("https://") ?: "")
        servidor.setOnEditorActionListener { _, accion, _ -> if (accion == EditorInfo.IME_ACTION_GO) { verificarServidor(); true } else false }
        findViewById<Button>(R.id.continuar).setOnClickListener { verificarServidor() }

        val usuario = findViewById<EditText>(R.id.usuario)
        val pin = findViewById<EditText>(R.id.pin)
        usuario.setText(ajustes.usuario ?: "")
        pin.setOnEditorActionListener { _, accion, _ -> if (accion == EditorInfo.IME_ACTION_GO) { entrar(); true } else false }
        findViewById<Button>(R.id.entrar).setOnClickListener { entrar() }
        findViewById<Button>(R.id.volver_servidor).setOnClickListener { mostrar(pasoServidor, pasoGuardia, atras = true) }
        findViewById<ImageButton>(R.id.ver_pin).setOnClickListener {
            val visible = pin.inputType and InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD != 0
            pin.inputType = InputType.TYPE_CLASS_TEXT or if (visible) InputType.TYPE_TEXT_VARIATION_PASSWORD else InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            pin.setSelection(pin.text.length)
        }

        // Volver con el servidor ya verificado: se salta al guardia, con el aviso de por qué.
        if (intent.getIntExtra(EXTRA_PASO, PASO_SERVIDOR) == PASO_GUARDIA && ajustes.servidor != null) {
            base = ajustes.servidor
            findViewById<TextView>(R.id.barrio).text = rotuloServidor(ajustes.barrio, ajustes.servidor!!)
            pasoServidor.visibility = View.GONE
            pasoGuardia.visibility = View.VISIBLE
            intent.getStringExtra(EXTRA_AVISO)?.let { error(R.id.error_guardia, it) }
            pin.requestFocus()
        } else {
            entrada(findViewById(R.id.marca), 0)
            entrada(pasoServidor, 90)
        }
    }

    private fun verificarServidor() {
        val escrito = findViewById<EditText>(R.id.servidor).text.toString()
        error(R.id.error_servidor, null)
        ocupado(R.id.continuar, R.id.girando_servidor, true)
        thread {
            val r = Servidor.verificar(escrito)
            runOnUiThread {
                ocupado(R.id.continuar, R.id.girando_servidor, false)
                when (r) {
                    is Servidor.Respuesta.Mal -> { error(R.id.error_servidor, r.mensaje); sacudir(findViewById(R.id.servidor)) }
                    is Servidor.Respuesta.Bien -> {
                        base = r.valor.base
                        ajustes.servidor = r.valor.base
                        ajustes.barrio = r.valor.barrio
                        findViewById<TextView>(R.id.barrio).text = rotuloServidor(r.valor.barrio, r.valor.base)
                        mostrar(pasoGuardia, pasoServidor, atras = false)
                        findViewById<EditText>(R.id.usuario).apply { requestFocus(); if (text.isNotEmpty()) findViewById<EditText>(R.id.pin).requestFocus() }
                    }
                }
            }
        }
    }

    private fun entrar() {
        val b = base ?: return
        val usuario = findViewById<EditText>(R.id.usuario).text.toString().trim()
        val clave = findViewById<EditText>(R.id.pin).text.toString()
        if (usuario.isEmpty() || clave.isEmpty()) { error(R.id.error_guardia, "Completá el usuario y el PIN."); return }
        error(R.id.error_guardia, null)
        ocupado(R.id.entrar, R.id.girando_guardia, true)
        thread {
            val r = Servidor.entrar(b, usuario, clave)
            runOnUiThread {
                ocupado(R.id.entrar, R.id.girando_guardia, false)
                when (r) {
                    is Servidor.Respuesta.Mal -> { error(R.id.error_guardia, r.mensaje); sacudir(findViewById(R.id.pin)) }
                    is Servidor.Respuesta.Bien -> {
                        ajustes.usuario = usuario
                        ajustes.clave = clave
                        esconderTeclado()
                        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK))
                        Curvas.fundido(this)
                        finish()
                    }
                }
            }
        }
    }

    private fun rotuloServidor(barrio: String?, base: String) =
        listOfNotNull(barrio, base.removePrefix("https://").removePrefix("http://")).joinToString(" · ")

    /** Cambio de paso: el que entra se desliza desde el costado hacia el que se va, como en iOS. */
    private fun mostrar(entra: View, sale: View, atras: Boolean) {
        val d = resources.displayMetrics.density * 36 * if (atras) -1 else 1
        sale.animate().alpha(0f).translationX(-d).setDuration(180).withEndAction {
            sale.visibility = View.GONE
            sale.translationX = 0f; sale.alpha = 1f
            entra.alpha = 0f; entra.translationX = d; entra.visibility = View.VISIBLE
            entra.animate().alpha(1f).translationX(0f).setDuration(320).setInterpolator(Curvas.ios).start()
        }.start()
    }

    private fun entrada(v: View, demora: Long) {
        v.alpha = 0f; v.translationY = 24 * resources.displayMetrics.density
        v.animate().alpha(1f).translationY(0f).setStartDelay(demora).setDuration(520).setInterpolator(Curvas.ios).start()
    }

    private fun sacudir(v: View) {
        val d = 8 * resources.displayMetrics.density
        v.animate().translationX(d).setDuration(50).withEndAction {
            v.animate().translationX(-d).setDuration(70).withEndAction {
                v.animate().translationX(d / 2).setDuration(60).withEndAction { v.animate().translationX(0f).setDuration(50).start() }.start()
            }.start()
        }.start()
    }

    private fun ocupado(boton: Int, girando: Int, si: Boolean) {
        val b = findViewById<Button>(boton)
        b.isEnabled = !si
        b.setTextColor(if (si) 0x00FFFFFF else 0xFFFFFFFF.toInt())
        findViewById<ProgressBar>(girando).visibility = if (si) View.VISIBLE else View.GONE
    }

    private fun error(id: Int, texto: String?) {
        val t = findViewById<TextView>(id)
        if (texto == null) { t.visibility = View.GONE; return }
        t.text = texto
        if (t.visibility != View.VISIBLE) { t.alpha = 0f; t.visibility = View.VISIBLE; t.animate().alpha(1f).setDuration(200).start() }
    }

    private fun esconderTeclado() {
        currentFocus?.let { getSystemService(InputMethodManager::class.java)?.hideSoftInputFromWindow(it.windowToken, 0) }
    }

    companion object {
        const val EXTRA_PASO = "paso"
        const val EXTRA_AVISO = "aviso"
        const val PASO_SERVIDOR = 0
        const val PASO_GUARDIA = 1
    }
}
