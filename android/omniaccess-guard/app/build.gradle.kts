import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/**
 * La firma de release NO vive en el repo: la clave de subida y sus contraseñas van en
 * `firma.properties` (ignorado por git) junto al .jks. Sin ese archivo el release sale sin firmar
 * y hay que firmarlo aparte; el debug sigue andando igual.
 */
val firma = Properties().apply {
    val f = rootProject.file("firma.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "omniaccess.infratec.com.uy"
    compileSdk = 36

    defaultConfig {
        applicationId = "omniaccess.infratec.com.uy"
        minSdk = 26
        // Play exige 36 para apps nuevas y actualizaciones desde el 31/08/2026.
        targetSdk = 36
        versionCode = 20
        versionName = "2.0.0"
    }

    signingConfigs {
        if (firma.getProperty("storeFile") != null) {
            create("subida") {
                storeFile = rootProject.file(firma.getProperty("storeFile"))
                storePassword = firma.getProperty("storePassword")
                keyAlias = firma.getProperty("keyAlias")
                keyPassword = firma.getProperty("keyPassword")
            }
        }
    }

    /**
     * Dos sabores con el mismo código de base:
     * - `play`: lo que acepta Google Play. Se actualiza por la tienda (nada de bajar e instalar
     *   APK por su cuenta), sin servicio de accesibilidad y sin arrancar solo al prender.
     * - `directa`: para las tablets fijas de garita que se instalan a mano. Suma la
     *   actualización desde el servidor, el pánico por volumen con la pantalla apagada
     *   (accesibilidad) y el arranque al encender.
     */
    flavorDimensions += "canal"
    productFlavors {
        create("play") { dimension = "canal" }
        create("directa") { dimension = "canal"; versionNameSuffix = "-directa" }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            isDebuggable = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfigs.findByName("subida")?.let { signingConfig = it }
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
    lint {
        abortOnError = true
        checkReleaseBuilds = true
        // Las traducciones son sólo español a propósito.
        disable += "MissingTranslation"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.core:core-splashscreen:1.2.0")
    implementation("androidx.activity:activity-ktx:1.11.0")
    implementation("androidx.webkit:webkit:1.14.0")
}
