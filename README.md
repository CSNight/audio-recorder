# audio-recorder

面向 `Recorder` 长期 TypeScript 重构的 Phase 1 录音核心链路。

## Commands

- `npm run dev`
- `npm run dev:playground`
- `npm run build`
- `npm run typecheck`
- `npm run test:unit`
- `npm run test:functional`
- `npm run test:functional:headed`
- `npm run check`

## Status

- Current phase: `Phase 1`
- Long-term plan: `Recorder-TS-Master-Plan.md`

## Implemented in Phase 1

- Typed `RecorderController` lifecycle: `open / start / pause / resume / stop / close / destroy`
- Browser capture adapter with microphone or external `MediaStream` input
- Real-time PCM frame dispatch with actual sample rate and channel count feedback
- Warning and state change events for runtime negotiation
- Browser capture prefers `AudioWorklet`, and only falls back to deprecated `ScriptProcessor` when runtime capability is insufficient

## Demo surfaces

- Root page: lifecycle diagnostic and upstream reference pointer
- `/playground/`: 中文手工测试工作台，覆盖麦克风和外部流场景

## Upstream baseline

- Upstream Recorder source is vendored at `vendor/Recorder-master`
- Future feature work should compare behavior against upstream code and demos, not only against `Recorder-TS-Master-Plan.md`
