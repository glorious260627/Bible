# 오늘의 말씀

성경 구절을 고르면 뜻을 쉬운 한국어로 풀고, 2026년 한국의 일상에 연결해 묵상하도록 돕는 설교형 말씀 길잡이입니다.

웹에서 사용하기: [oneul-malsseum.glorious260627.chatgpt.site](https://oneul-malsseum.glorious260627.chatgpt.site)

## 주요 기능

- 창세기부터 요한계시록까지 66권 선택
- 각 장의 실제 마지막 절 표시
- 앞뒤 문맥이 이어지는 추천 단락 선택(예: 잠언 1장 1–7절, 8–19절, 20–33절)
- 유효한 절 안에서 시작·끝 범위 직접 선택
- 힘든 마음을 적으면 상황별 말씀 단락 추천과 맞춤형 설교 제공(배포 웹에서는 브라우저 안에서 분류하며 저장하지 않음)
- 브라우저·기기의 한국어 음성으로 설교 무료 듣기, 일시정지, 이어 듣기
- 본문 맥락, 핵심 메시지, 예시, 오늘의 적용, 묵상 질문, 결단과 기도 제공
- 하늘산성감리교회 설교에서 참고한 친근한 흐름(일상적인 도입 → 본문 설명 → 삶의 적용 → 결단)
- 북마크, 글자 크기 조절, 기도문 복사, 간단한 후속 질문

## 로컬 실행

Node.js와 pnpm이 설치된 환경에서 다음 명령을 실행합니다.

```bash
pnpm install
pnpm dev
```

프로덕션 빌드는 `pnpm build`로 확인할 수 있습니다.

## 개인 로컬 실행

Codex CLI에 로그인된 이 컴퓨터에서 다음 명령을 실행하면 웹 화면과 개인 설교 생성 연결이 함께 시작됩니다. 고민으로 추천받은 말씀뿐 아니라 직접 고른 본문도 그 정확한 범위에 맞춰 더 깊이 해설합니다.

```bash
pnpm local
```

화면과 연결 서버는 `127.0.0.1`에만 열립니다. 로컬 화면에 입력한 고민은 이 사이트에 저장되지 않지만, 맞춤 설교를 만들 때 로그인된 Codex를 통해 OpenAI로 전달되며 Codex 이용량이 적용될 수 있습니다. 배포된 웹에서는 이 연결을 사용하지 않고 브라우저 안의 주제별 추천만 사용합니다.

## Android APK 빌드

의존성을 설치한 뒤 다음 한 명령으로 웹 정적 번들 생성, Capacitor 동기화, Gradle debug 빌드와 APK 복사를 모두 실행합니다.

```bash
pnpm run android:apk
```

완성된 APK는 [`artifacts/oneul-malsseum-debug.apk`](./artifacts/oneul-malsseum-debug.apk)에 생성됩니다. Gradle 원본은 `android/app/build/outputs/apk/debug/app-debug.apk`에 남습니다. APK는 원격 `server.url` 없이 `out`의 웹 자산을 앱 안에 담으므로, 설치 후 화면과 성경 본문을 로컬 번들에서 불러옵니다.

빌드 스크립트는 JDK와 Android SDK를 다음 순서로 찾습니다.

1. `JAVA_HOME`, `ANDROID_HOME` 환경 변수
2. Android Studio의 기본 JBR·SDK 설치 경로
3. `%LOCALAPPDATA%\BibleBuildTools\jdk21`, `%LOCALAPPDATA%\BibleBuildTools\android-sdk`의 휴대용 도구

JDK 21과 Android SDK(platform 36 및 build-tools)가 위 경로 중 하나에 준비되어 있어야 합니다.

## 안내

이 서비스는 목회자나 교회 공동체를 대신하지 않는 AI 말씀 이해 도구입니다. 앱에는 창세기부터 요한계시록까지 PLAY X 번역의 정식 장·절 31,103절이 내장되어 있습니다. 원본 데이터에 섞여 있던 비표준·중복 키 13개는 제외했으며, 정식 절의 본문 문구는 변경하지 않았습니다.

본문 출처 표시는 **PLAY X 번역(플레이엑스) · 번역: 김무송 · CC BY 4.0**입니다. [원본 저장소](https://github.com/PLAYX1/playx-bible)와 [CC BY 4.0 라이선스](https://creativecommons.org/licenses/by/4.0/)를 확인할 수 있습니다. 이 번역은 개인 번역이며 공개 검증이 진행 중인 비공인 번역입니다. 이 앱은 PLAY X 또는 번역자와 공식 제휴·후원·승인 관계가 없습니다.

장·절 한계는 Bible Passage Reference Parser의 기본 절 체계를 사용합니다. 추천 단락은 Berean Standard Bible v5.9의 공개 USFM 구조 표지를 바탕으로 읽기 좋은 길이로 정리했으며, 성경 번역본이나 편집 방식에 따라 구분이 조금 다를 수 있습니다. 자세한 출처와 라이선스는 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)에서 확인할 수 있습니다.
