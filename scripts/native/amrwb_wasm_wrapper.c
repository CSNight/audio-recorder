/**
 * AMR-WB WASM bridge.
 *
 * Reuses the public vo-amrwbenc E_IF_* API and stores the most recent encoded
 * frame in a fixed buffer that JS can read by pointer.
 */

#include "enc_if.h"
#include <stddef.h>
#include <stdint.h>

#define AMRWB_MAX_FRAME_BYTES 128
#define AMRWB_MAX_MODE 8

typedef struct AmrWbEncoderContext AmrWbEncoderContext;

static unsigned char amrwb_output_buffer[AMRWB_MAX_FRAME_BYTES];
static int amrwb_output_size = 0;

AmrWbEncoderContext *amrwb_encoder_create(void) {
  amrwb_output_size = 0;
  return (AmrWbEncoderContext *)E_IF_init();
}

void amrwb_encoder_destroy(AmrWbEncoderContext *ctx) {
  if (ctx != NULL) {
    E_IF_exit((void *)ctx);
  }
  amrwb_output_size = 0;
}

int amrwb_encode_frame(
  AmrWbEncoderContext *ctx,
  const int16_t *pcm,
  int mode
) {
  int encoded_size = 0;

  if (ctx == NULL || pcm == NULL) {
    amrwb_output_size = 0;
    return -1;
  }

  if (mode < 0 || mode > AMRWB_MAX_MODE) {
    amrwb_output_size = 0;
    return -1;
  }

  encoded_size = E_IF_encode(
    (void *)ctx,
    mode,
    (const short *)pcm,
    amrwb_output_buffer,
    0
  );

  if (encoded_size <= 0 || encoded_size > AMRWB_MAX_FRAME_BYTES) {
    amrwb_output_size = 0;
    return -1;
  }

  amrwb_output_size = encoded_size;
  return encoded_size;
}

unsigned char *amrwb_get_output_ptr(void) {
  return amrwb_output_buffer;
}

int amrwb_get_output_size(void) {
  return amrwb_output_size;
}
