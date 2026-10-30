# El puente con la consola: R8 no puede ver que lo llama JavaScript, así que se conservan sus métodos.
-keepclassmembers class omniaccess.infratec.com.uy.PuenteGuardia {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
