# Playground

`playground/` 现在是一个独立的 Vite + Vue 工程，只消费主包根目录已经构建好的 `../dist` 产物。

## 运行

先在仓库根目录构建主包产物：

```bash
npm run build
```

再进入 `playground/` 安装并启动：

```bash
cd playground
npm install
npm run dev
```

## 说明

- 不修改主包的 `package.json`、`vite.config.ts` 或源码结构。
- 通过 `@audio-recorder-dist` alias 指向 `../dist`，用于验证对外导出行为。
- 当前 playground 重点用于验证录音、实时导出、持久化与多格式导出链路。
