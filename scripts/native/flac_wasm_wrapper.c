/**
 * FLAC WASM wrapper
 *
 * This wrapper handles the write callback complexity for FLAC stream encoding.
 * Instead of passing JS function pointers to C (which requires Emscripten's
 * addFunction mechanism), we use a static C-side buffer that accumulates
 * encoded output, which JS reads via _fc_get_output_ptr/_fc_get_output_size.
 */

#include <FLAC/stream_encoder.h>
#include <stdlib.h>
#include <string.h>

// Static output buffer (grows as needed)
static unsigned char *output_buffer = NULL;
static size_t output_buffer_size = 0;
static size_t output_buffer_capacity = 0;

// Initial buffer capacity (64KB)
#define INITIAL_CAPACITY (64 * 1024)

/**
 * Write callback for FLAC encoder
 * Accumulates encoded data into the static output buffer
 */
static FLAC__StreamEncoderWriteStatus write_callback(
  const FLAC__StreamEncoder *encoder,
  const FLAC__byte buffer[],
  size_t bytes,
  unsigned samples,
  unsigned current_frame,
  void *client_data
) {
  (void)encoder;
  (void)samples;
  (void)current_frame;
  (void)client_data;

  // Ensure buffer has enough capacity
  if (output_buffer_size + bytes > output_buffer_capacity) {
    size_t new_capacity = output_buffer_capacity == 0 ? INITIAL_CAPACITY : output_buffer_capacity * 2;
    while (new_capacity < output_buffer_size + bytes) {
      new_capacity *= 2;
    }

    unsigned char *new_buffer = (unsigned char *)realloc(output_buffer, new_capacity);
    if (!new_buffer) {
      return FLAC__STREAM_ENCODER_WRITE_STATUS_FATAL_ERROR;
    }

    output_buffer = new_buffer;
    output_buffer_capacity = new_capacity;
  }

  // Append data to buffer
  memcpy(output_buffer + output_buffer_size, buffer, bytes);
  output_buffer_size += bytes;

  return FLAC__STREAM_ENCODER_WRITE_STATUS_OK;
}

/**
 * Initialize FLAC stream encoder with static write callback
 * Replaces FLAC__stream_encoder_init_stream which requires function pointer
 */
FLAC__StreamEncoderInitStatus fc_init_encoder(FLAC__StreamEncoder *encoder) {
  return FLAC__stream_encoder_init_stream(
    encoder,
    write_callback,
    NULL,  // seek_callback (not needed for streaming)
    NULL,  // tell_callback (not needed for streaming)
    NULL,  // metadata_callback (not needed)
    NULL   // client_data
  );
}

/**
 * Get pointer to output buffer (for JS to read)
 */
unsigned char *fc_get_output_ptr(void) {
  return output_buffer;
}

/**
 * Get current output buffer size
 */
size_t fc_get_output_size(void) {
  return output_buffer_size;
}

/**
 * Reset output buffer (call before each encode operation)
 */
void fc_reset_output(void) {
  output_buffer_size = 0;
}
