plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.dhl.gps"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.dhl.gps"
        minSdk = 26
        targetSdk = 34
        versionCode = 4
        versionName = "1.3"
    }

    // Fester Signaturschlüssel, damit Updates über vorherige Installationen
    // funktionieren (gleiche App-Signatur bei jedem Build).
    signingConfigs {
        create("release") {
            storeFile = file("geoguard-release.keystore")
            storePassword = "geoguard"
            keyAlias = "geoguard"
            keyPassword = "geoguard"
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            // Auch Debug-Builds mit demselben Schlüssel signieren -> einheitliche Signatur
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.0")
}
