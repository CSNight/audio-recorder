# Documentation

项目文档统一收敛在 `docs/` 目录，按“入口说明 -> 当前架构 -> 长期方案”的顺序组织，避免根目录继续堆积长文档。

## 文档结构

- [architecture/execution-chain.md](./architecture/execution-chain.md)
  当前代码实现的执行链路、模块职责、状态机、输入降级策略、DSP 主链路插件、FFT / DTMF / NMN2PCM 等扩展，以及流式导出与子路径边界。
- [plans/recorder-ts-master-plan.md](./plans/recorder-ts-master-plan.md)
  TypeScript 化长期主方案、阶段计划、实施约束，以及已落地的 `streaming-player`、`sonic-export`、`frequency-histogram`、`dtmf`、`nmn2pcm`、`dsp` 现状说明。

## 推荐阅读顺序

1. 先看仓库根目录 [README.md](../README.md) 或 [README.zh-CN.md](../README.zh-CN.md)，了解当前对外能力、入口和兼容性信息。
2. 再看 [architecture/execution-chain.md](./architecture/execution-chain.md)，理解现在这版实现怎么工作。
3. 最后看 [plans/recorder-ts-master-plan.md](./plans/recorder-ts-master-plan.md)，理解长期演进方向与未开发阶段。

## 文档维护约束

- `README.md` 以当前已实现能力为准，不写计划中的目标能力
- 架构文档描述当前代码，不替未来方案预埋不存在的模块
- 方案文档保留长期规划语义，尤其 `Phase 5`、`Phase 6` 未开发内容不得随意改写
