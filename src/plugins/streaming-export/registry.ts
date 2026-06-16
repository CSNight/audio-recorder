import type { ChunkedEncoderDefinition } from "@/plugins/streaming-export/types"

/**
 * ChunkedEncoderRegistry：管理所有已注册的 ChunkedEncoder 工厂。
 *
 * Worker 和主线程使用同一个注册表实例（通过 import 共享），
 * 确保两端的编码器实现完全一致，不维护两套代码。
 */
export class ChunkedEncoderRegistry {
  private readonly encoders = new Map<string, ChunkedEncoderDefinition<any>>()

  /**
   * 注册一个 ChunkedEncoder 工厂。
   * 同一 format 重复注册时覆盖旧定义，便于测试注入替代实现。
   */

  register<TOptions>(definition: ChunkedEncoderDefinition<TOptions>): void {
    this.encoders.set(definition.format, definition)
  }

  /** 获取指定 format 的工厂定义，不存在时抛出 */

  get(format: string): ChunkedEncoderDefinition<any> {
    const definition = this.encoders.get(format)
    if (!definition) {
      throw new Error(
        `ChunkedEncoder for format "${format}" is not registered. ` +
          `Available formats: ${[...this.encoders.keys()].join(", ") || "(none)"}`
      )
    }
    return definition
  }

  /** 是否已注册指定 format */
  has(format: string): boolean {
    return this.encoders.has(format)
  }
}

/**
 * 全局默认注册表，内置 PCM/WAV/MP3 三种格式。
 * 业务侧也可自行 new ChunkedEncoderRegistry() 构造独立实例。
 */
export const defaultChunkedEncoderRegistry = new ChunkedEncoderRegistry()
