plugins {
    kotlin("jvm") version "2.4.10" apply false
}

// Aggregate: `./gradlew ps4p` builds every provider's .ps4p into build/ps4p/ (see gradle/ps4p.gradle.kts).
tasks.register("ps4p") {
    group = "ps4p"
    description = "Builds all Kotlin providers into build/ps4p/<id>.ps4p"
    dependsOn(subprojects.filter { it.path.startsWith(":providers:") }.map { "${it.path}:ps4p" })
}
