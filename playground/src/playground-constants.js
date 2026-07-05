import { RecorderInputSource } from "@csnight/audio-recorder"
import { createIndexedDbPersistencePlugin } from "@csnight/audio-recorder/storage/indexeddb"
import { createOpfsPersistencePlugin } from "@csnight/audio-recorder/storage/opfs"
import {
  pcmExportEncoder,
  wavExportEncoder,
} from "@csnight/audio-recorder/codecs/base"
import { mp3ExportEncoder } from "@csnight/audio-recorder/codecs/mp3"
import { g711ExportEncoder } from "@csnight/audio-recorder/codecs/g711"
import {
  oggExportEncoder,
  webmExportEncoder,
} from "@csnight/audio-recorder/codecs/opus"
import { flacExportEncoder } from "@csnight/audio-recorder/codecs/flac"
import { aacExportEncoder } from "@csnight/audio-recorder/codecs/aac"
import { amrExportEncoder } from "@csnight/audio-recorder/codecs/amr"
import {
  ac3ExportEncoder,
  eac3ExportEncoder,
} from "@csnight/audio-recorder/codecs/ac3"

export const PLAYGROUND_SOURCE_MODE = {
  microphone: RecorderInputSource.Microphone,
  externalTone: "external-tone",
}

export const PLAYGROUND_STORAGE_MODE = {
  memory: "memory",
  persistent: "persistent",
  auto: "auto",
}

export const PLAYGROUND_LOCALE = {
  zh: "zh-CN",
  en: "en-US",
}

export const LOCALE_OPTIONS = [
  {
    value: PLAYGROUND_LOCALE.zh,
    shortLabel: "中",
    label: "中文",
  },
  {
    value: PLAYGROUND_LOCALE.en,
    shortLabel: "EN",
    label: "English",
  },
]

export const PLAYGROUND_PERSISTENCE_BACKEND = {
  indexeddb: "indexeddb",
  opfs: "opfs",
}

export const PLAYGROUND_PERSISTENCE_CHUNK_BYTES = 256 * 1024

export const STANDARD_EXPORT_SAMPLE_RATES = [
  7350, 8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 64000,
  88200, 96000, 176400, 192000,
]

export const PERSISTENCE_PLUGIN_FACTORIES = {
  [PLAYGROUND_PERSISTENCE_BACKEND.indexeddb]: createIndexedDbPersistencePlugin,
  [PLAYGROUND_PERSISTENCE_BACKEND.opfs]: createOpfsPersistencePlugin,
}

export const EXPORT_FORMAT_ACTIONS = [
  { type: "pcm", label: "PCM", encoder: pcmExportEncoder },
  { type: "wav", label: "WAV", encoder: wavExportEncoder },
  { type: "mp3", label: "MP3", encoder: mp3ExportEncoder },
  { type: "g711", label: "G.711", encoder: g711ExportEncoder },
  { type: "aac", label: "AAC", encoder: aacExportEncoder },
  {
    type: "amr-nb",
    exportFormat: "amr",
    bandMode: "nb",
    label: "AMR NB",
    encoder: amrExportEncoder,
  },
  {
    type: "amr-wb",
    exportFormat: "amr",
    bandMode: "wb",
    label: "AMR WB",
    encoder: amrExportEncoder,
  },
  { type: "ac3", label: "AC3", encoder: ac3ExportEncoder },
  { type: "eac3", label: "E-AC3", encoder: eac3ExportEncoder },
  { type: "ogg", label: "Opus OGG", encoder: oggExportEncoder },
  { type: "webm", label: "Opus WebM", encoder: webmExportEncoder },
  { type: "flac", label: "FLAC", encoder: flacExportEncoder },
]
