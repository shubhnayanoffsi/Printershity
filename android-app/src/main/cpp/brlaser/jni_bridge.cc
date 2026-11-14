// JNI adapter around the GPL-2.0-or-later brlaser raster encoder.
#include <jni.h>
#include <stdio.h>
#include <stdint.h>
#include <vector>
#include <string>
#include "job.h"

namespace {
struct RasterInput {
  const uint8_t *data;
  int row_bytes;
  int height;
  int next_row;
};
thread_local RasterInput *current_input = nullptr;

bool next_raster_line(std::vector<uint8_t> &line) {
  if (!current_input || current_input->next_row >= current_input->height) return false;
  const uint8_t *start = current_input->data + (size_t)current_input->next_row * current_input->row_bytes;
  line.assign(start, start + current_input->row_bytes);
  ++current_input->next_row;
  return true;
}
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_com_brother_hl1201print_BrotherRaster_encode(JNIEnv *env, jclass,
    jbyteArray raster, jint width, jint height, jint rowBytes, jint copies, jstring paper) {
  if (!raster || width <= 0 || height <= 0 || rowBytes != (width + 7) / 8 ||
      env->GetArrayLength(raster) != (jlong)rowBytes * height) return nullptr;
  jbyte *raw = env->GetByteArrayElements(raster, nullptr);
  if (!raw) return nullptr;
  const char *paperChars = env->GetStringUTFChars(paper, nullptr);
  if (!paperChars) { env->ReleaseByteArrayElements(raster, raw, JNI_ABORT); return nullptr; }

  char *output_bytes = nullptr;
  size_t output_size = 0;
  FILE *output = open_memstream(&output_bytes, &output_size);
  if (!output) {
    env->ReleaseStringUTFChars(paper, paperChars);
    env->ReleaseByteArrayElements(raster, raw, JNI_ABORT);
    return nullptr;
  }
  RasterInput input{reinterpret_cast<const uint8_t *>(raw), rowBytes, height, 0};
  current_input = &input;
  {
    job print_job(output, "HL1201-Android-OTG");
    page_params params{};
    params.num_copies = copies > 0 ? copies : 1;
    params.resolution = 600;
    params.duplex = false;
    params.economode = false;
    params.sourcetray = "AUTO";
    params.mediatype = "PLAIN";
    params.papersize = paperChars;
    print_job.encode_page(params, height, rowBytes, next_raster_line);
  }
  current_input = nullptr;
  env->ReleaseStringUTFChars(paper, paperChars);
  env->ReleaseByteArrayElements(raster, raw, JNI_ABORT);
  fclose(output);
  if (!output_bytes || output_size == 0 || output_size > 0x7fffffff) {
    free(output_bytes);
    return nullptr;
  }
  jbyteArray result = env->NewByteArray((jsize)output_size);
  if (result) env->SetByteArrayRegion(result, 0, (jsize)output_size,
                                      reinterpret_cast<const jbyte *>(output_bytes));
  free(output_bytes);
  return result;
}
