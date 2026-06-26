/**
 * AMR-WB WASM wrapper placeholder
 *
 * Bridge symbols only. Replace with real vo-amrwbenc integration later.
 */

#include <stdint.h>
#include <stdlib.h>

typedef struct AmrWbEncoderContext AmrWbEncoderContext;

AmrWbEncoderContext *amrwb_encoder_create(void) {
  return NULL;
}

void amrwb_encoder_destroy(AmrWbEncoderContext *ctx) {
  (void)ctx;
}

int amrwb_encode_frame(
  AmrWbEncoderContext *ctx,
  const int16_t *pcm,
  int mode
) {
  (void)ctx;
  (void)pcm;
  (void)mode;
  return -1;
}

unsigned char *amrwb_get_output_ptr(void) {
  return NULL;
}

int amrwb_get_output_size(void) {
  return 0;
}
