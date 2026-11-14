#!/usr/bin/env sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(dirname -- "$APP_DIR")
SDK_ROOT=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-/data/data/com.termux/files/home/opt/android-sdk}}
PLATFORM=${ANDROID_PLATFORM:-android-35}
TOOLS_VERSION=${ANDROID_BUILD_TOOLS:-35.0.0}
ANDROID_JAR="$SDK_ROOT/platforms/$PLATFORM/android.jar"
OUT="$REPO_DIR/Brother-HL1201-Print.apk"
JNI_SOURCE="$APP_DIR/src/main/cpp/brlaser"
JNI_LIBS="$APP_DIR/src/main/jniLibs/arm64-v8a"
CXX=${ANDROID_CXX:-aarch64-linux-android-clang++}
JAVA_HOME=${JAVA_HOME:-/data/data/com.termux/files/usr/lib/jvm/java-21-openjdk}

if [ ! -f "$ANDROID_JAR" ]; then
  echo "Android platform jar not found: $ANDROID_JAR" >&2
  echo "Install $PLATFORM or set ANDROID_SDK_ROOT and ANDROID_PLATFORM." >&2
  exit 1
fi

find_tool() {
  name=$1
  sdk_tool="$SDK_ROOT/build-tools/$TOOLS_VERSION/$name"
  if command -v "$name" >/dev/null 2>&1; then
    command -v "$name"
  elif [ -x "$sdk_tool" ]; then
    printf '%s\n' "$sdk_tool"
  else
    echo "Required Android build tool not found: $name" >&2
    exit 1
  fi
}

AAPT=$(find_tool aapt)
D8=$(find_tool d8)
ZIPALIGN=$(find_tool zipalign)
APKSIGNER=$(find_tool apksigner)

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT HUP INT TERM
mkdir -p "$WORK/gen" "$WORK/classes" "$WORK/dex" "$WORK/native/lib/arm64-v8a"

"$AAPT" package -f \
  -M "$APP_DIR/AndroidManifest.xml" \
  -S "$APP_DIR/res" \
  -A "$APP_DIR/assets" \
  -I "$ANDROID_JAR" \
  --min-sdk-version 24 \
  --target-sdk-version 35 \
  --version-code 4 \
  --version-name 2.2 \
  -J "$WORK/gen" \
  -F "$WORK/base.apk"

"$CXX" -std=c++17 -O2 -fPIC -shared -stdlib=libc++ \
  -I"$JNI_SOURCE" -I"$JAVA_HOME/include" -I"$JAVA_HOME/include/linux" \
  "$JNI_SOURCE/jni_bridge.cc" "$JNI_SOURCE/job.cc" "$JNI_SOURCE/line.cc" \
  -o "$WORK/native/lib/arm64-v8a/libbrlaser_jni.so"
cp "${PREFIX:-/data/data/com.termux/files/usr}/lib/libc++_shared.so" "$WORK/native/lib/arm64-v8a/libc++_shared.so"

find "$APP_DIR/src/com" "$WORK/gen" -name '*.java' -print > "$WORK/sources.txt"
javac -source 8 -target 8 -bootclasspath "$ANDROID_JAR" \
  -d "$WORK/classes" @"$WORK/sources.txt"

# D8 accepts the compiled class files directly.
find "$WORK/classes" -name '*.class' -print > "$WORK/classes.txt"
# shellcheck disable=SC2046
"$D8" --lib "$ANDROID_JAR" --min-api 21 --output "$WORK/dex" $(cat "$WORK/classes.txt")

cp "$WORK/base.apk" "$WORK/unsigned.apk"
jar uf "$WORK/unsigned.apk" -C "$WORK/dex" classes.dex
jar uf "$WORK/unsigned.apk" -C "$WORK/native" lib/arm64-v8a/libbrlaser_jni.so
jar uf "$WORK/unsigned.apk" -C "$WORK/native" lib/arm64-v8a/libc++_shared.so
"$ZIPALIGN" -f -p 4 "$WORK/unsigned.apk" "$WORK/aligned.apk"

SIGNING_DIR="$APP_DIR/.signing"
KEYSTORE="$SIGNING_DIR/printshity-release.keystore"
PASSWORD_FILE="$SIGNING_DIR/password"
if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$SIGNING_DIR"
  chmod 700 "$SIGNING_DIR"
  umask 077
  PASS=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
  printf '%s\n%s\n' "$PASS" "$PASS" > "$PASSWORD_FILE"
  keytool -genkeypair -noprompt \
    -keystore "$KEYSTORE" -storetype PKCS12 \
    -alias printshity -keyalg RSA -keysize 3072 -validity 10000 \
    -storepass "$PASS" -keypass "$PASS" \
    -dname "CN=Printshity Local Release,O=Printshity"
  chmod 600 "$KEYSTORE" "$PASSWORD_FILE"
fi
if [ ! -f "$PASSWORD_FILE" ]; then
  echo "Signing password is missing: $PASSWORD_FILE" >&2
  exit 1
fi

"$APKSIGNER" sign \
  --ks "$KEYSTORE" --ks-key-alias printshity \
  --ks-pass "file:$PASSWORD_FILE" --key-pass "file:$PASSWORD_FILE" \
  --out "$OUT" "$WORK/aligned.apk"
cp "$OUT" "$REPO_DIR/public/Brother-HL1201-Print.apk"
rm -f "$REPO_DIR/public/Brother-HL1201-Print.apk.idsig"
echo "Built $OUT"
