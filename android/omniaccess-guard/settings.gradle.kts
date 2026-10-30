// El espejo de Maven Central de Google va primero: Central corta con «429 Too Many Requests» a
// las compilaciones automáticas, y es el mismo contenido.
val espejoCentral = "https://maven-central.storage-download.googleapis.com/maven2/"

pluginManagement {
    repositories { google(); maven("https://maven-central.storage-download.googleapis.com/maven2/"); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); maven(espejoCentral); mavenCentral() }
}
rootProject.name = "omniaccess-guard"
include(":app")
