# theia-chat-debug

Theia AI용 Chat Debug / LLM Trace 확장과 예제 애플리케이션입니다.

확장 패키지: [`theia-chat-debug/`](./theia-chat-debug/)

## Features

- **Chat Debug** 뷰 — LLM 턴/step 검사 (OpenAI-style messages)
- **JSONL** 디스크 로그 + **LLM Trace** Output 채널
- Export / Reveal 명령, 비밀키 redaction

## Prerequisites

[Theia prerequisites](https://github.com/eclipse-theia/theia/blob/master/doc/Developing.md#prerequisites)

## Setup

```bash
npm install
```

## Browser example

```bash
npm run build:browser
npm run start:browser
```

Open http://localhost:3000 — 명령 팔레트에서 `Chat Debug: Open`.

## Electron example

```bash
npm run build:electron
npm run start:electron
```

## Watch

```bash
npm run watch:browser
# or
npm run watch:electron
```

## Publish extension

```bash
cd theia-chat-debug
npm publish
```

호스트 앱 `package.json`에 `"theia-chat-debug": "^0.1.0"`을 추가하면 됩니다. Theia 버전은 호스트와 맞추세요 (현재 개발 기준 `1.76.0`).
