# Brother HL-1201 Direct USB-OTG Print Studio

A direct USB Type-A to Type-B + USB Type-C OTG monochrome laser image printing studio and GDI raster preprocessor built specifically for the **Brother HL-1201** (`HL-1200` / `HL-1110` series) laser printer.

## 1. Hardware Specifications & Protocol Architecture

- **Target Model:** Brother HL-1201 (Electrophotographic Monochrome Laser)
- **Physical Connectivity:** USB 2.0 Full-Speed (`Type-A to Type-B` printer cable connected via `USB Type-C OTG` host adapter). No Wi-Fi, no Bluetooth.
- **USB Identifiers:** Vendor ID `0x04F9` (Brother Industries, Ltd.), Product ID `0x0062` / `0x0054` / `0x0330`
- **Resolution:** `600 × 600 DPI` native (`HQ1200` / `2400 × 600 DPI` effective, `300 × 300 DPI` low-memory draft)
- **Internal Printer RAM:** `1,024 KB` (`1 MB`)
- **Hardware Unprintable Drum Margin:** `4.23 mm` (`0.166 in`) on all four edges
- **Paper Tray Capacity:** `150 sheets` standard input cassette (`80 gsm` plain paper), `50 sheets` face-down output tray
- **Supported Media Sizes:** `A4` (`210×297 mm`), `Letter` (`215.9×279.4 mm`), `Legal` (`215.9×355.6 mm`), `Folio` (`215.9×330.2 mm`), `A5` (`148×210 mm`), `B5` (`182×257 mm`), `Executive` (`184.2×266.7 mm`), plus Custom feed sizes (`148–216 mm` × `148–355.6 mm`).

### Why Standard Image Streaming Fails on the Brother HL-1201
Unlike enterprise printers that natively decode PDF, PostScript, or PCL6, the Brother HL-1201 uses a **host-based GDI raster protocol** (`brlaser`) with only **1 MB of internal RAM**. Sending a raw `.jpg` or `.png` over USB-OTG will not print. Images must first be:
1. Scaled to exact physical millimeter sheet geometry and masked outside the `4.23 mm` laser drum clamp border.
2. Dithered into a **1-bit monochrome halftone bitmap** (`Atkinson`, `Floyd–Steinberg`, `Bayer 4×4`, or `Binary Threshold`).
3. Wrapped in **PJL (`@PJL ENTER LANGUAGE = PCL`) + Type-B PackBits RLE compressed scanlines** or sent through an OS/OTG print spooler (`CUPS brlaser` / Android USB Print Service).

## 2. How to Run Locally

```bash
# Install dependencies
npm install

# Start development server on port 3000
npm run dev

# Build for production
npm run build
```

## 3. Direct USB-OTG Printing Methods

1. **System / Android OTG Print Spooler (`Print via System / Android OTG Spooler`):**
   Renders all selected sheets at exact millimeter `@page` geometry with 1-bit halftoning applied, ready for Android OTG printer bridges (NokoPrint, PrinterShare, Mopria) or desktop CUPS (`printer-driver-brlaser`) and Windows Brother drivers.
2. **Direct WebUSB Bulk-OUT Streaming (`USB-OTG Connection` tab):**
   Open the application in a top-level Chrome tab on Android (connected via USB-C OTG) or Desktop, click **Pair USB-OTG Printer**, select `Brother HL-1201 (0x04F9)`, and stream the compiled PJL+RLE buffer directly to USB Endpoint OUT.
3. **Raw `.PRN` Export + Portable Python / Termux Script:**
   Click **Download Raw Brother .PRN** and send it via `/dev/usb/lp0` or `pyusb` using the included Python script in the **Portable CLI & Specs** tab.


## Android APK

Download and install the signed Android app from the repository's latest release:

[Download Brother HL-1201 Print APK](https://github.com/shubhnayanoffsi/Printershity/releases/latest/download/Brother-HL1201-Print.apk)

The current package is version 2.1 (version code 3), targets Android 15 / API 35, and supports Android 16. It requires a USB-host capable Android device, a USB-C OTG adapter, and an Android print service that supports USB OTG. The app sends prepared pages through Android Print Framework so the selected service can render the HL-1201-specific printer language. Install and enable a USB-OTG print service such as NokoPrint, then select it in the Android print dialog.

### Build the APK locally

Install a JDK and Android SDK platform 35, then run from the repository root:

```sh
ANDROID_SDK_ROOT=/path/to/android-sdk sh android-app/build-apk.sh
```

The script writes `Brother-HL1201-Print.apk` at the repository root and updates the website download at `public/Brother-HL1201-Print.apk`. It creates a local signing key in `android-app/.signing/`; keep that directory private and backed up if you need future APKs to install as updates. The key is ignored by Git and is not bundled inside the APK.
