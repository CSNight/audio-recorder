// lamejs 没有官方类型声明，这里手写最小类型描述。
declare module "lamejs" {
  interface Mp3Encoder {
    encodeBuffer(left: Int16Array, right: Int16Array): Int8Array
    flush(): Int8Array
  }

  interface Mp3EncoderConstructor {
    new (channels: number, sampleRate: number, kbps: number): Mp3Encoder
  }

  const Mp3Encoder: Mp3EncoderConstructor
  export { Mp3Encoder }
}
