# Brother raster encoder

The raster encoder files in `brlaser/` are from Peter De Wachter's brlaser project, version 6, licensed under GPL-2.0-or-later. They implement the Brother HL-1200-series raster stream used here over USB bulk OUT. Upstream: https://github.com/pdewacht/brlaser

`jni_bridge.cc` adapts the upstream `job` and line encoder to accept one-bit K-channel rows from the Android image renderer.
