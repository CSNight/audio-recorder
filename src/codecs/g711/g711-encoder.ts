/**
 * ITU-T G.711 编码算法。
 *
 * A-law：欧洲/国际电话标准（PCMA）
 * U-law（μ-law）：北美/日本电话标准（PCMU）
 *
 * 算法移植自：https://github.com/xiangyuecn/Recorder g711x.js
 * 输入：16-bit signed PCM，输出：8-bit G.711 压缩编码（0~255）
 */

// 用于定位段号的查找表（索引为 pcm_val>>8 & 0x7F，值为段号+1）
const SEG_TABLE = new Uint8Array([
  1, 2, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5,
  6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
])

/**
 * 将 16-bit signed PCM 样本编码为 G.711 A-law（PCMA）字节。
 */
export function encodeAlaw(sample: number): number {
  let pcmVal = Math.max(-32768, Math.min(32767, sample | 0))

  let mask: number
  if (pcmVal >= 0) {
    mask = 0xd5 // sign bit = 1
  } else {
    mask = 0x55 // sign bit = 0
    pcmVal = -pcmVal - 1
  }

  const seg = ((SEG_TABLE[(pcmVal >> 8) & 0x7f] ?? 8) - 1)

  let aval = seg << 4
  if (seg < 2) {
    aval |= (pcmVal >> 4) & 0xf
  } else {
    aval |= (pcmVal >> (seg + 3)) & 0xf
  }

  return aval ^ mask
}

/**
 * 将 16-bit signed PCM 样本编码为 G.711 U-law（μ-law / PCMU）字节。
 */
export function encodeUlaw(sample: number): number {
  let pcmVal = Math.max(-32768, Math.min(32767, sample | 0))

  let mask: number
  if (pcmVal < 0) {
    pcmVal = 0x84 - pcmVal // 负数：加偏置取反（正值化）
    mask = 0x7f            // 最终 XOR mask（bit7=0 表示负）
  } else {
    pcmVal += 0x84         // 正数：加偏置
    mask = 0xff            // 最终 XOR mask（bit7=1 表示正）
  }

  const seg = ((SEG_TABLE[(pcmVal >> 8) & 0x7f] ?? 8) - 1)

  const uval = (seg << 4) | ((pcmVal >> (seg + 3)) & 0xf)
  return uval ^ mask
}
