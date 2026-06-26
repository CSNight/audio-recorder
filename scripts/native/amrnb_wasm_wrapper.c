/**
 * AMR-NB WASM bridge.
 *
 * Calls the upstream opencore-amr encoder API directly and exposes the most
 * recent encoded frame through a fixed buffer that JS can read by pointer.
 */

#include "interf_enc.h"
#include <stddef.h>
#include <stdint.h>

#define AMRNB_MAX_FRAME_BYTES 32

typedef struct AmrNbEncoderContext AmrNbEncoderContext;

static unsigned char amrnb_output_buffer[AMRNB_MAX_FRAME_BYTES];
static int amrnb_output_size = 0;

AmrNbEncoderContext *amrnb_encoder_create(void) {
  amrnb_output_size = 0;
  return (AmrNbEncoderContext *)Encoder_Interface_init(0);
}

void amrnb_encoder_destroy(AmrNbEncoderContext *ctx) {
  if (ctx != NULL) {
    Encoder_Interface_exit((void *)ctx);
  }
  amrnb_output_size = 0;
}

int amrnb_encode_frame(
  AmrNbEncoderContext *ctx,
  const int16_t *pcm,
  int mode
) {
  int encoded_size = 0;

  if (ctx == NULL || pcm == NULL) {
    amrnb_output_size = 0;
    return -1;
  }

  if (mode < MR475 || mode >= N_MODES) {
    amrnb_output_size = 0;
    return -1;
  }

  encoded_size = Encoder_Interface_Encode(
    (void *)ctx,
    (enum Mode)mode,
    (const short *)pcm,
    amrnb_output_buffer,
    0
  );

  if (encoded_size <= 0 || encoded_size > AMRNB_MAX_FRAME_BYTES) {
    amrnb_output_size = 0;
    return -1;
  }

  amrnb_output_size = encoded_size;
  return encoded_size;
}

unsigned char *amrnb_get_output_ptr(void) {
  return amrnb_output_buffer;
}

int amrnb_get_output_size(void) {
  return amrnb_output_size;
}
