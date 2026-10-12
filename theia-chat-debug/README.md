# theia-chat-debug

Theia AI용 **Chat Debug** 뷰와 **LLM Trace** 확장입니다.

`LanguageModelService` 세션을 구독해 턴/step 단위로 LLM 요청·응답을 검사하고, JSONL·Output 채널에 기록합니다.

## Features

- Bottom area **Chat Debug** 뷰 — 턴 목록 + step별 OpenAI-style messages JSON 트리
- Disk JSONL: `<configDir>/logs/llm-trace/YYYY-MM-DD.jsonl`
- Output 채널: `LLM Trace`
- Export / Reveal 명령
- API key 패턴 redaction

## Preferences

| Key | Default | Description |
|-----|---------|-------------|
| `chatDebug.llmTrace.enabled` | `true` | 마스터 스위치 (디스크/Output) |
| `chatDebug.llmTrace.writeToDisk` | `true` | JSONL 기록 |
| `chatDebug.llmTrace.writeToOutput` | `true` | Output 채널 요약 |

## Commands

- `Chat Debug: Open`
- `Chat Debug: Reveal LLM Trace Log`
- `Chat Debug: Export LLM Trace JSON`

## Host requirements

호스트 Theia 앱에 `@theia/ai-core`(및 AI chat 스택)가 포함되어 있어야 합니다. AI Agent History와 공존합니다.

## Install in an application

```json
{
  "dependencies": {
    "theia-chat-debug": "^0.1.0"
  }
}
```

Theia가 `theiaExtensions`를 읽어 frontend 모듈을 자동 로드합니다.

## Develop

모노레포 루트에서:

```bash
npm install
npm --prefix theia-chat-debug run build
```

예제 앱:

```bash
npm run build:browser
npm run start:browser
```

## Publish

```bash
cd theia-chat-debug
npm publish
```
