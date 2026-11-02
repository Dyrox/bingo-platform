plugins {
    // match the Kotlin version bundled in fabric-language-kotlin, which provides the stdlib at runtime
    kotlin("jvm") version "2.3.21"
    kotlin("plugin.serialization") version "2.3.21"
    // Minecraft 26.x ships unobfuscated, so this is the non-remapping Loom that YAB itself uses
    id("net.fabricmc.fabric-loom") version "1.18-SNAPSHOT"
}

version = property("mod_version") as String
group = "dev.dyrox"
base.archivesName = "bingo-reporter"

repositories {
    mavenCentral()
}

val bingoApi = files("libs/bingo-api-${property("bingo_api_version")}.jar")

dependencies {
    minecraft("com.mojang:minecraft:${property("minecraft_version")}")
    implementation("net.fabricmc:fabric-loader:${property("loader_version")}")
    implementation("net.fabricmc:fabric-language-kotlin:${property("fabric_kotlin_version")}")
    // for registering /bingo link; YAB itself requires Fabric API, so it's always there
    implementation("net.fabricmc.fabric-api:fabric-api:${property("fabric_api_version")}")

    // YAB's public API. It's nested inside the YAB jar at runtime, so it's only needed to compile.
    // The jar in libs/ is copied from bingo-<version>.jar!/META-INF/jars/.
    compileOnly(bingoApi)
    testImplementation(bingoApi)

    testImplementation(kotlin("test"))
}

kotlin {
    jvmToolchain(25)
}

tasks.processResources {
    inputs.property("version", project.version)
    filesMatching("fabric.mod.json") {
        expand("version" to project.version)
    }
}

tasks.test {
    useJUnitPlatform()
}
