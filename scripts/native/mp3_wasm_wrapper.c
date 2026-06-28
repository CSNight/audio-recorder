#include <stdlib.h>

#include <emscripten/emscripten.h>

#include "lame.h"

typedef struct {
  lame_global_flags *gfp;
} Mp3EncoderContext;

enum Mp3RateMode {
  MP3_RATE_MODE_CBR = 0,
  MP3_RATE_MODE_ABR = 1,
  MP3_RATE_MODE_VBR = 2,
};

enum Mp3ChannelMode {
  MP3_CHANNEL_MODE_MONO = 0,
  MP3_CHANNEL_MODE_STEREO = 1,
  MP3_CHANNEL_MODE_JOINT_STEREO = 2,
};

static int clamp_quality(int quality) {
  if (quality < 0) {
    return 0;
  }
  if (quality > 9) {
    return 9;
  }
  return quality;
}

static MPEG_mode to_lame_channel_mode(int channel_mode) {
  switch (channel_mode) {
    case MP3_CHANNEL_MODE_MONO:
      return MONO;
    case MP3_CHANNEL_MODE_JOINT_STEREO:
      return JOINT_STEREO;
    case MP3_CHANNEL_MODE_STEREO:
    default:
      return STEREO;
  }
}

EMSCRIPTEN_KEEPALIVE
Mp3EncoderContext *init_lame(
  int channels,
  int input_sample_rate,
  int output_sample_rate,
  int rate_mode,
  int bitrate_kbps,
  int vbr_quality,
  int channel_mode,
  int quality
) {
  lame_global_flags *gfp = lame_init();
  if (!gfp) {
    return NULL;
  }

  lame_set_num_channels(gfp, channels);
  lame_set_in_samplerate(gfp, input_sample_rate);
  lame_set_out_samplerate(gfp, output_sample_rate);
  lame_set_mode(gfp, to_lame_channel_mode(channel_mode));
  lame_set_quality(gfp, clamp_quality(quality));
  lame_set_bWriteVbrTag(gfp, 0);
  lame_set_write_id3tag_automatic(gfp, 0);

  switch (rate_mode) {
    case MP3_RATE_MODE_ABR:
      lame_set_VBR(gfp, vbr_abr);
      lame_set_VBR_mean_bitrate_kbps(gfp, bitrate_kbps);
      break;
    case MP3_RATE_MODE_VBR:
      lame_set_VBR(gfp, vbr_mtrh);
      lame_set_VBR_q(gfp, clamp_quality(vbr_quality));
      break;
    case MP3_RATE_MODE_CBR:
    default:
      lame_set_VBR(gfp, vbr_off);
      lame_set_brate(gfp, bitrate_kbps);
      break;
  }

  if (lame_init_params(gfp) < 0) {
    lame_close(gfp);
    return NULL;
  }

  Mp3EncoderContext *ctx = malloc(sizeof(Mp3EncoderContext));
  if (!ctx) {
    lame_close(gfp);
    return NULL;
  }

  ctx->gfp = gfp;
  return ctx;
}

EMSCRIPTEN_KEEPALIVE
int encode_samples(
  Mp3EncoderContext *ctx,
  short int left_buf[],
  short int right_buf[],
  int sample_count,
  unsigned char *dest_buf,
  int dest_buf_size
) {
  return lame_encode_buffer(
    ctx->gfp,
    left_buf,
    right_buf,
    sample_count,
    dest_buf,
    dest_buf_size
  );
}

EMSCRIPTEN_KEEPALIVE
int flush_lame(
  Mp3EncoderContext *ctx,
  unsigned char *dest_buf,
  int dest_buf_size
) {
  return lame_encode_flush(ctx->gfp, dest_buf, dest_buf_size);
}

EMSCRIPTEN_KEEPALIVE
void close_lame(Mp3EncoderContext *ctx) {
  if (!ctx) {
    return;
  }

  if (ctx->gfp) {
    lame_close(ctx->gfp);
  }
  free(ctx);
}
