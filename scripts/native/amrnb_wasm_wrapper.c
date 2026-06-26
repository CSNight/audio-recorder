/**
 * AMR-NB WASM wrapper placeholder
 *
 * Bridge symbols only. Replace with real opencore-amr integration later.
 */

#include <stdint.h>
#include <stdlib.h>

typedef struct AmrNbEncoderContext AmrNbEncoderContext;

AmrNbEncoderContext *amrnb_encoder_create(void) {
  return NULL;
}

void amrnb_encoder_destroy(AmrNbEncoderContext *ctx) {
  (void)ctx;
}

int amrnb_encode_frame(
  AmrNbEncoderContext *ctx,
  const int16_t *pcm,
  int mode
) {
  (void)ctx;
  (void)pcm;
  (void)mode;
  return -1;
}

unsigned char *amrnb_get_output_ptr(void) {
  return NULL;
}

int amrnb_get_output_size(void) {
  return 0;
}
