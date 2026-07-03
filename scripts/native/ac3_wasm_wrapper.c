#include <stdint.h>
#include <stdlib.h>

#include "libavcodec/avcodec.h"
#include "libavutil/channel_layout.h"
#include "libavutil/error.h"
#include "libavutil/log.h"

typedef struct {
  AVCodecContext *codec_ctx;
  AVPacket *packet;
  AVFrame *frame;
  float *input_buffer;
  int input_buffer_size;
} EncoderContext;

static enum AVCodecID codec_id_from_js(int codec_id) {
  return codec_id == 0 ? AV_CODEC_ID_AC3 : AV_CODEC_ID_EAC3;
}

EncoderContext *init_encoder(
  int codec_id,
  int channels,
  int sample_rate,
  int bitrate
) {
  av_log_set_level(AV_LOG_ERROR);

  const AVCodec *codec = avcodec_find_encoder(codec_id_from_js(codec_id));
  if (!codec) {
    return NULL;
  }

  AVCodecContext *codec_ctx = avcodec_alloc_context3(codec);
  if (!codec_ctx) {
    return NULL;
  }

  codec_ctx->sample_fmt = AV_SAMPLE_FMT_FLTP;
  codec_ctx->sample_rate = sample_rate;
  codec_ctx->bit_rate = bitrate;
  codec_ctx->time_base = (AVRational){1, sample_rate};

  AVChannelLayout layout;
  av_channel_layout_default(&layout, channels);
  av_channel_layout_copy(&codec_ctx->ch_layout, &layout);
  av_channel_layout_uninit(&layout);

  if (avcodec_open2(codec_ctx, codec, NULL) < 0) {
    avcodec_free_context(&codec_ctx);
    return NULL;
  }

  AVPacket *packet = av_packet_alloc();
  if (!packet) {
    avcodec_free_context(&codec_ctx);
    return NULL;
  }

  AVFrame *frame = av_frame_alloc();
  if (!frame) {
    av_packet_free(&packet);
    avcodec_free_context(&codec_ctx);
    return NULL;
  }

  frame->format = AV_SAMPLE_FMT_FLTP;
  frame->sample_rate = sample_rate;
  frame->nb_samples = codec_ctx->frame_size;
  av_channel_layout_copy(&frame->ch_layout, &codec_ctx->ch_layout);

  if (av_frame_get_buffer(frame, 0) < 0) {
    av_frame_free(&frame);
    av_packet_free(&packet);
    avcodec_free_context(&codec_ctx);
    return NULL;
  }

  EncoderContext *ctx = malloc(sizeof(EncoderContext));
  if (!ctx) {
    av_frame_free(&frame);
    av_packet_free(&packet);
    avcodec_free_context(&codec_ctx);
    return NULL;
  }

  ctx->codec_ctx = codec_ctx;
  ctx->packet = packet;
  ctx->frame = frame;
  ctx->input_buffer = NULL;
  ctx->input_buffer_size = 0;

  return ctx;
}

int get_encoder_frame_size(EncoderContext *ctx) {
  return ctx->codec_ctx->frame_size;
}

float *get_encode_input_ptr(EncoderContext *ctx, int size) {
  if (ctx->input_buffer_size < size) {
    free(ctx->input_buffer);
    ctx->input_buffer = malloc(size);
    if (!ctx->input_buffer) {
      ctx->input_buffer_size = 0;
      return NULL;
    }
    ctx->input_buffer_size = size;
  }

  return ctx->input_buffer;
}

int send_frame(EncoderContext *ctx, int64_t pts) {
  int channels = ctx->codec_ctx->ch_layout.nb_channels;
  int frame_size = ctx->frame->nb_samples;

  ctx->frame->pts = pts;

  if (av_frame_make_writable(ctx->frame) < 0) {
    return AVERROR(EINVAL);
  }

  for (int ch = 0; ch < channels; ch++) {
    float *plane = (float *)ctx->frame->data[ch];
    for (int i = 0; i < frame_size; i++) {
      plane[i] = ctx->input_buffer[i * channels + ch];
    }
  }

  return avcodec_send_frame(ctx->codec_ctx, ctx->frame);
}

int receive_packet(EncoderContext *ctx) {
  av_packet_unref(ctx->packet);

  int ret = avcodec_receive_packet(ctx->codec_ctx, ctx->packet);
  if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF) {
    return 0;
  }
  if (ret < 0) {
    return ret;
  }

  return ctx->packet->size;
}

void flush_encoder_start(EncoderContext *ctx) {
  avcodec_send_frame(ctx->codec_ctx, NULL);
}

uint8_t *get_encoded_data(EncoderContext *ctx) {
  return ctx->packet->data;
}

void close_encoder(EncoderContext *ctx) {
  free(ctx->input_buffer);
  av_frame_free(&ctx->frame);
  av_packet_free(&ctx->packet);
  avcodec_free_context(&ctx->codec_ctx);
  free(ctx);
}
