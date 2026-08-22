import { constants as fsConstants } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadPersonalAiConfig } from "./personal-ai-config.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const androidDirectory = path.join(projectDirectory, "android");
const sourceApk = path.join(
  androidDirectory,
  "app",
  "build",
  "outputs",
  "apk",
  "debug",
  "app-debug.apk",
);
const artifactDirectory = path.join(projectDirectory, "artifacts");
const destinationApk = path.join(
  artifactDirectory,
  "oneul-malsseum-debug.apk",
);

const isWindows = process.platform === "win32";
const executableSuffix = isWindows ? ".exe" : "";

function cleanEnvironmentPath(value) {
  if (!value) return undefined;

  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

async function isFile(filePath) {
  if (!filePath) return false;

  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(directoryPath) {
  if (!directoryPath) return false;

  try {
    return (await stat(directoryPath)).isDirectory();
  } catch {
    return false;
  }
}

async function isJavaHome(directoryPath) {
  return isFile(
    path.join(directoryPath, "bin", `java${executableSuffix}`),
  );
}

async function isAndroidSdk(directoryPath) {
  if (!(await isDirectory(directoryPath))) return false;

  return (
    (await isDirectory(path.join(directoryPath, "platforms"))) &&
    (await isDirectory(path.join(directoryPath, "build-tools")))
  );
}

async function directSubdirectories(directoryPath) {
  if (!(await isDirectory(directoryPath))) return [];

  const entries = await readdir(directoryPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(directoryPath, entry.name))
    .sort((left, right) => right.localeCompare(left, "en"));
}

async function chooseFirstValid(candidates, validator, toolName) {
  for (const candidate of candidates) {
    if (!candidate?.path) continue;

    if (await validator(candidate.path)) {
      console.log(`[Android] ${toolName}: ${candidate.path} (${candidate.label})`);
      return candidate.path;
    }

    if (candidate.reportInvalid) {
      console.warn(
        `[Android] ${candidate.label} 경로를 사용할 수 없어 다음 후보를 확인합니다: ${candidate.path}`,
      );
    }
  }

  return undefined;
}

async function resolveJavaHome() {
  const localAppData = cleanEnvironmentPath(process.env.LOCALAPPDATA);
  const programFiles = cleanEnvironmentPath(process.env.ProgramFiles);
  const portableRoot = localAppData
    ? path.join(localAppData, "BibleBuildTools", "jdk21")
    : undefined;
  const portableCandidates = portableRoot
    ? [portableRoot, ...(await directSubdirectories(portableRoot))]
    : [];

  const javaHome = await chooseFirstValid(
    [
      {
        path: cleanEnvironmentPath(process.env.JAVA_HOME),
        label: "JAVA_HOME",
        reportInvalid: Boolean(process.env.JAVA_HOME),
      },
      {
        path: programFiles
          ? path.join(programFiles, "Android", "Android Studio", "jbr")
          : undefined,
        label: "Android Studio 기본 JBR",
      },
      {
        path: localAppData
          ? path.join(localAppData, "Programs", "Android Studio", "jbr")
          : undefined,
        label: "사용자용 Android Studio JBR",
      },
      ...portableCandidates.map((candidatePath) => ({
        path: candidatePath,
        label: "BibleBuildTools 휴대용 JDK 21",
      })),
    ],
    isJavaHome,
    "JDK",
  );

  if (!javaHome) {
    throw new BuildError(
      "JDK를 찾지 못했습니다. JAVA_HOME을 설정하거나 Android Studio/JDK 21을 설치해 주세요.",
    );
  }

  return javaHome;
}

async function resolveAndroidHome() {
  const localAppData = cleanEnvironmentPath(process.env.LOCALAPPDATA);
  const androidHome = await chooseFirstValid(
    [
      {
        path: cleanEnvironmentPath(process.env.ANDROID_HOME),
        label: "ANDROID_HOME",
        reportInvalid: Boolean(process.env.ANDROID_HOME),
      },
      {
        path: cleanEnvironmentPath(process.env.ANDROID_SDK_ROOT),
        label: "ANDROID_SDK_ROOT",
        reportInvalid: Boolean(process.env.ANDROID_SDK_ROOT),
      },
      {
        path: localAppData
          ? path.join(localAppData, "Android", "Sdk")
          : undefined,
        label: "Android Studio 기본 SDK",
      },
      {
        path: localAppData
          ? path.join(localAppData, "BibleBuildTools", "android-sdk")
          : undefined,
        label: "BibleBuildTools 휴대용 Android SDK",
      },
    ],
    isAndroidSdk,
    "Android SDK",
  );

  if (!androidHome) {
    throw new BuildError(
      "Android SDK를 찾지 못했습니다. ANDROID_HOME을 설정하거나 Android Studio SDK를 설치해 주세요.",
    );
  }

  return androidHome;
}

class BuildError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "BuildError";
    this.exitCode = exitCode;
  }
}

function runCommand(label, command, args, options) {
  console.log(`\n[Android] ${label}`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: "inherit",
      windowsHide: true,
    });

    child.once("error", (error) => {
      reject(new BuildError(`${label} 실행에 실패했습니다: ${error.message}`));
    });

    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const exitCode = Number.isInteger(code) && code > 0 ? code : 1;
      const signalNote = signal ? ` (signal: ${signal})` : "";
      reject(
        new BuildError(
          `${label} 명령이 종료 코드 ${String(code)}로 실패했습니다${signalNote}.`,
          exitCode,
        ),
      );
    });
  });
}

async function resolvePnpmLauncher() {
  const npmExecPath = cleanEnvironmentPath(process.env.npm_execpath);
  if (
    npmExecPath &&
    path.basename(npmExecPath).toLowerCase().includes("pnpm") &&
    (await isFile(npmExecPath))
  ) {
    return {
      command: process.execPath,
      arguments: [npmExecPath],
    };
  }

  throw new BuildError(
    "현재 pnpm 실행 경로를 확인하지 못했습니다. `pnpm run android:apk`로 실행해 주세요.",
  );
}

function createBuildEnvironment(javaHome, androidHome) {
  const extraPathEntries = [
    path.join(javaHome, "bin"),
    path.join(androidHome, "platform-tools"),
    path.join(androidHome, "cmdline-tools", "latest", "bin"),
  ];

  return {
    ...process.env,
    JAVA_HOME: javaHome,
    ANDROID_HOME: androidHome,
    ANDROID_SDK_ROOT: androidHome,
    PATH: [extraPathEntries.join(path.delimiter), process.env.PATH]
      .filter(Boolean)
      .join(path.delimiter),
  };
}

async function copyApkArtifact() {
  await access(sourceApk, fsConstants.R_OK);
  const sourceStats = await stat(sourceApk);
  if (!sourceStats.isFile() || sourceStats.size === 0) {
    throw new BuildError(`생성된 APK가 올바르지 않습니다: ${sourceApk}`);
  }

  await mkdir(artifactDirectory, { recursive: true });
  const temporaryApk = path.join(
    artifactDirectory,
    `.oneul-malsseum-debug.${process.pid}.tmp`,
  );

  try {
    await copyFile(sourceApk, temporaryApk);
    await rm(destinationApk, { force: true });
    await rename(temporaryApk, destinationApk);
  } finally {
    await rm(temporaryApk, { force: true });
  }

  const destinationStats = await stat(destinationApk);
  if (destinationStats.size !== sourceStats.size) {
    throw new BuildError("복사한 APK의 크기가 원본과 다릅니다.");
  }

  console.log(
    `\n[Android] APK 생성 완료 (${destinationStats.size.toLocaleString("ko-KR")} bytes)`,
  );
  console.log(`[Android] ${destinationApk}`);
}

async function main() {
  const [javaHome, androidHome, pnpmLauncher, personalAi] = await Promise.all([
    resolveJavaHome(),
    resolveAndroidHome(),
    resolvePnpmLauncher(),
    loadPersonalAiConfig(),
  ]);
  const buildEnvironment = {
    ...createBuildEnvironment(javaHome, androidHome),
    NEXT_PUBLIC_BIBLE_LOCAL_AI_BASE: personalAi.baseUrl,
    NEXT_PUBLIC_BIBLE_LOCAL_AI_TOKEN: personalAi.token,
  };
  console.log(`[Android] 개인용 AI 연결: ${personalAi.baseUrl}`);

  await runCommand(
    "웹 정적 번들 생성 및 Capacitor 동기화",
    pnpmLauncher.command,
    [...pnpmLauncher.arguments, "run", "android:sync"],
    { cwd: projectDirectory, env: buildEnvironment },
  );

  const gradleWrapper = path.join(
    androidDirectory,
    isWindows ? "gradlew.bat" : "gradlew",
  );
  await access(gradleWrapper, fsConstants.R_OK);

  if (isWindows) {
    const commandPrompt = path.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "cmd.exe",
    );
    await runCommand(
      "Gradle debug APK 빌드",
      commandPrompt,
      ["/d", "/s", "/c", "gradlew.bat assembleDebug"],
      { cwd: androidDirectory, env: buildEnvironment },
    );
  } else {
    await runCommand(
      "Gradle debug APK 빌드",
      gradleWrapper,
      ["assembleDebug"],
      { cwd: androidDirectory, env: buildEnvironment },
    );
  }

  await copyApkArtifact();
}

main().catch((error) => {
  const exitCode =
    error instanceof BuildError && Number.isInteger(error.exitCode)
      ? error.exitCode
      : 1;
  console.error(`\n[Android] 빌드 실패: ${error.message}`);
  process.exitCode = exitCode;
});
