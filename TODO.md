# TODO — theia-chat-debug 확장 분리

## Status
- Phase: Done (standalone + theia-ide 연동)
- Updated: 2026-10-12

## Goal
cocrates-ai에 있던 Chat Debug + LLM Trace 기능을 독립 Theia 확장 `theia-chat-debug`로 이식·배포 가능하게 만든다.

## Done
- [x] yeoman scaffold 확인
- [x] 확장 소스 이식 (model/redact/prefs/service/widget/contribution/CSS)
- [x] package.json 의존성 + peerDependencies (Theia 1.77.0-next.25)
- [x] browser/electron 예제 앱
- [x] `npm run build` 검증
- [x] README 갱신
- [x] theia-ide: `cocrates-ai`에서 chat-debug/llm-trace 중복 제거
- [x] theia-ide: electron / electron-next / browser에 `file:` 의존성 추가
- [x] legacy pref fallback: `cocrates.llmTrace.*` → `chatDebug.llmTrace.*`

## Notes
- Package: `theia-chat-debug@0.1.0`
- Prefs: `chatDebug.llmTrace.enabled|writeToDisk|writeToOutput`
- Widget id: `theia-chat-debug`
- Commands: `Chat Debug: Open|Reveal LLM Trace Log|Export LLM Trace JSON`
- Host: `"theia-chat-debug": "file:../../../theia-chat-debug/theia-chat-debug"`
- **@theia/\*는 peerDependencies만** — dependencies에 두면 host 번들에 core 이중 포함 → 스플래시 고착
- Publish: `cd theia-chat-debug && npm publish`
