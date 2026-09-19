plugins {
    id("com.android.application")
    kotlin("android")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("org.jetbrains.kotlin.plugin.compose")
}

import java.util.Properties

fun escapeBuildConfig(value: String): String = value
    .replace("\\", "\\\\")
    .replace("\"", "\\\"")

val webEnvProperties = Properties().apply {
    val envFile = rootProject.file("web/.env")
    if (envFile.exists()) {
        envFile.inputStream().use(::load)
    }
}

fun resolveRuntimeValue(name: String): String {
    val gradleProperty = providers.gradleProperty(name).orNull
    if (!gradleProperty.isNullOrBlank()) return gradleProperty

    val environmentValue = providers.environmentVariable(name).orNull
    if (!environmentValue.isNullOrBlank()) return environmentValue

    return webEnvProperties.getProperty(name)?.trim().orEmpty()
}

android {
    namespace = "com.promethean.tdiab"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.promethean.tdiab"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }

        buildConfigField("String", "SUPABASE_URL", "\"${escapeBuildConfig(resolveRuntimeValue("VITE_SUPABASE_URL"))}\"")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\"${escapeBuildConfig(resolveRuntimeValue("VITE_SUPABASE_ANON_KEY"))}\"")
        buildConfigField("String", "TURN_URL", "\"${escapeBuildConfig(resolveRuntimeValue("VITE_TURN_URL"))}\"")
        buildConfigField("String", "TURN_USERNAME", "\"${escapeBuildConfig(resolveRuntimeValue("VITE_TURN_USERNAME"))}\"")
        buildConfigField("String", "TURN_CREDENTIAL", "\"${escapeBuildConfig(resolveRuntimeValue("VITE_TURN_CREDENTIAL"))}\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.15"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        isCoreLibraryDesugaringEnabled = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(project(":shared"))

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.4")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("io.github.webrtc-sdk:android:125.6422.07")

    implementation(platform("androidx.compose:compose-bom:2024.09.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")

    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.2")
}
