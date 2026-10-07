// Shared by every provider module: the `ps4p` task (compile -> own-classes jar -> D8 -> zip).
// Output: <root>/build/ps4p/<id>.ps4p (zip with exactly manifest.json + classes.dex) and <id>.manifest.json
// (a copy of the manifest, so scripts/build.mjs need not unzip). <id> = the module folder name.

val providerId = project.name
val d8Version = "9.5.23" // com.android.tools:r8 from google()

tasks.withType<Test>().configureEach { useJUnitPlatform() }

val d8 by configurations.creating
dependencies { add("d8", "com.android.tools:r8:$d8Version") }

val outDir = rootProject.layout.buildDirectory.dir("ps4p")
val providerJar = tasks.named<Jar>("jar")
val dexDir = layout.buildDirectory.dir("ps4p-dex")
val compileClasspath = configurations.named("compileClasspath")

// The plain `jar` task only contains this module's own classes (compileOnly deps are not packaged).
val dexTask = tasks.register<JavaExec>("dex") {
    group = "ps4p"
    description = "Runs D8 over the provider's own classes"
    dependsOn(providerJar)
    classpath = d8
    mainClass.set("com.android.tools.r8.D8")
    val jar = providerJar.flatMap { it.archiveFile }
    inputs.file(jar)
    inputs.files(compileClasspath)
    outputs.dir(dexDir)
    doFirst {
        val out = dexDir.get().asFile
        out.deleteRecursively()
        out.mkdirs()
        val a = mutableListOf("--release", "--min-api", "26", "--output", out.absolutePath)
        // Types the app provides (stdlib, provider-api) are referenced, not bundled.
        compileClasspath.get().files.forEach { a += listOf("--classpath", it.absolutePath) }
        // java.* library types for desugaring/linking: the running JDK.
        a += listOf("--lib", System.getProperty("java.home"))
        a += jar.get().asFile.absolutePath
        args = a
    }
}

tasks.register<Zip>("ps4p") {
    group = "ps4p"
    description = "Builds build/ps4p/$providerId.ps4p (manifest.json + classes.dex)"
    dependsOn(dexTask, tasks.named("test"))
    destinationDirectory.set(outDir)
    archiveFileName.set("$providerId.ps4p")
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
    includeEmptyDirs = false
    from(layout.projectDirectory.file("manifest.json"))
    from(dexDir) { include("classes.dex") }
    eachFile { if (name != "manifest.json" && name != "classes.dex") exclude() }
    doLast {
        copy {
            from(layout.projectDirectory.file("manifest.json"))
            into(outDir)
            rename { "$providerId.manifest.json" }
        }
    }
}
