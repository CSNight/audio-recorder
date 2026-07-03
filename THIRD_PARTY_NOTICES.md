# Third-Party Notices

This project builds and distributes WebAssembly codec artifacts from several
third-party C/C++ libraries. The following table is based on the current build
scripts under `scripts/wasm/`.

This file is a license notice summary, not legal advice. Downstream distributors
should review the upstream license texts and their own distribution model.

## Codec Dependencies

| Artifact                           | Build script                  | Upstream library                                | Version | License                                                    |
|------------------------------------|-------------------------------|-------------------------------------------------|--------:|------------------------------------------------------------|
| `src/codecs/opus/libopus.wasm.mjs` | `scripts/wasm/build-opus.mjs` | libopus                                         |   1.6.1 | BSD-style, commonly distributed as BSD-3-Clause            |
| `src/codecs/mp3/libmp3.wasm.mjs`   | `scripts/wasm/build-mp3.mjs`  | LAME                                            |   3.100 | LGPL                                                       |
| `src/codecs/flac/libflac.wasm.mjs` | `scripts/wasm/build-flac.mjs` | libFLAC                                         |   1.4.3 | BSD-style, commonly distributed as BSD-3-Clause            |
| `src/codecs/aac/libaac.wasm.mjs`   | `scripts/wasm/build-aac.mjs`  | FFmpeg AAC encoder (`libavcodec` / `libavutil`) |   8.1.2 | LGPL when built with `--disable-gpl` as in this repository |
| `src/codecs/amr/libamrnb.wasm.mjs` | `scripts/wasm/build-amr.mjs`  | opencore-amr                                    |   0.1.6 | Apache-2.0                                                 |
| `src/codecs/amr/libamrwb.wasm.mjs` | `scripts/wasm/build-amr.mjs`  | vo-amrwbenc                                     |   0.1.3 | Apache-2.0                                                 |

## Source Locations and Checksums

The build scripts pin source archives and checksums:

| Library      | Source URL in build script                                                                            | Checksum type |
|--------------|-------------------------------------------------------------------------------------------------------|---------------|
| libopus      | `https://downloads.xiph.org/releases/opus/opus-1.6.1.tar.gz`                                          | SHA-256       |
| LAME         | `https://sourceforge.net/projects/lame/files/lame/3.100/lame-3.100.tar.gz/download`                   | SHA-256       |
| libFLAC      | `https://downloads.xiph.org/releases/flac/flac-1.4.3.tar.xz`                                          | SHA-256       |
| FFmpeg       | `https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz`                                                     | SHA-256       |
| opencore-amr | `https://sourceforge.net/projects/opencore-amr/files/opencore-amr/opencore-amr-0.1.6.tar.gz/download` | SHA-1         |
| vo-amrwbenc  | `https://sourceforge.net/projects/opencore-amr/files/vo-amrwbenc/vo-amrwbenc-0.1.3.tar.gz/download`   | SHA-1         |

## LGPL Components

The MP3 and AAC WASM artifacts include LGPL-licensed components:

- LAME for MP3
- FFmpeg libraries for AAC

The corresponding build scripts and local wrapper sources are included in this
repository so users can inspect and rebuild the WASM artifacts:

- `scripts/wasm/build-mp3.mjs`
- `scripts/wasm/build-aac.mjs`
- `scripts/native/mp3_wasm_wrapper.c`
- `scripts/native/aac_wasm_wrapper.c`

If you redistribute modified versions of these artifacts, review the applicable
LGPL requirements, including source availability and the ability for recipients
to replace or relink the LGPL-covered components where required.
