pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositories {
        mavenCentral()
        google()
    }
}

rootProject.name = "ps4-providers-kotlin"

include(":provider-api")

// Every folder under providers/ with a build.gradle.kts is a provider module (:providers:<id>).
file("providers").listFiles()
    ?.filter { it.isDirectory && File(it, "build.gradle.kts").exists() }
    ?.sortedBy { it.name }
    ?.forEach { include(":providers:${it.name}") }
