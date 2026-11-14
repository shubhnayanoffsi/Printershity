package com.brother.hl1201print;

/** Encodes 1-bit pages with the GPL brlaser Brother HL-1200 raster encoder. */
final class BrotherRaster {
    static { System.loadLibrary("brlaser_jni"); }
    private BrotherRaster() {}
    static void ensureLoaded() {}
    static native byte[] encode(byte[] raster, int width, int height, int rowBytes, int copies, String paper);
}
