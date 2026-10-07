plugins {
    kotlin("jvm")
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

dependencies {
    // Provided by the app at runtime: never bundled into classes.dex.
    compileOnly(project(":provider-api"))
    compileOnly(kotlin("stdlib"))

    testImplementation(project(":provider-api"))
    testImplementation(kotlin("stdlib"))
    testImplementation(kotlin("test-junit5"))
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

apply(from = rootProject.file("gradle/ps4p.gradle.kts"))
