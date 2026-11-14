'use client';

import React, {useState, useEffect, useRef, useMemo, useCallback} from 'react';
import {
  Printer,
  Upload,
  Trash2,
  RotateCw,
  CheckSquare,
  Square,
  Download,
  Usb,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  BROTHER_HL1201_USB,
  PAPER_SIZES,
  PaperSizeId,
  PrintSettings,
  ImageItem,
  getSheetDimensions,
  buildPages,
  convertToMonochromeLaser,
  encodeBrotherHl1201Job,
} from '@/lib/brother-hl1201';

interface WebUsbEndpoint {
  endpointNumber: number;
  direction: 'in' | 'out';
}

interface WebUsbDevice {
  vendorId: number;
  productId: number;
  productName?: string;
  configuration?: {
    interfaces: Array<{
      alternates: Array<{
        endpoints: WebUsbEndpoint[];
      }>;
    }>;
  };
  open(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  transferOut(
    endpointNumber: number,
    data: BufferSource
  ): Promise<{status: string; bytesWritten: number}>;
}

export default function BrotherHl1201App() {
  const [files, setFiles] = useState<ImageItem[]>([]);
  const [settings, setSettings] = useState<PrintSettings>({
    paperSize: 'A4',
    orientation: 'portrait',
    marginTopMm: 10,
    marginRightMm: 10,
    marginBottomMm: 10,
    marginLeftMm: 10,
    fitMode: 'contain',
    imagesPerPage: 1,
    copies: 1,
  });

  const [pageIndex, setPageIndex] = useState(0);
  const [usbDevice, setUsbDevice] = useState<WebUsbDevice | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [isPrinting, setIsPrinting] = useState(false);
  const [printDataUrls, setPrintDataUrls] = useState<string[]>([]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  const pages = useMemo(() => buildPages(files, settings), [files, settings]);
  const activePageIndex =
    pages.length === 0 ? 0 : Math.min(pageIndex, pages.length - 1);

  const selectedFilesCount = useMemo(
    () => files.filter((f) => f.selected).length,
    [files]
  );

  const totalSheetsToPrint = pages.length * Math.max(1, settings.copies || 1);
  const {widthMm, heightMm} = getSheetDimensions(settings);

  const loadImage = useCallback((item: ImageItem): Promise<HTMLImageElement> => {
    const cached = imageCacheRef.current.get(item.id);
    if (cached && cached.complete && cached.naturalWidth > 0) {
      return Promise.resolve(cached);
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        imageCacheRef.current.set(item.id, img);
        resolve(img);
      };
      img.onerror = reject;
      img.src = item.dataUrl;
    });
  }, []);

  const renderPageToCanvas = useCallback(
    async (
      canvas: HTMLCanvasElement,
      page: {pageNumber: number; items: ImageItem[]} | undefined,
      pxPerMm: number,
      drawMarginGuide: boolean
    ) => {
      const dims = getSheetDimensions(settings);
      const cw = Math.max(100, Math.round(dims.widthMm * pxPerMm));
      const ch = Math.max(100, Math.round(dims.heightMm * pxPerMm));

      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }

      const ctx = canvas.getContext('2d', {willReadFrequently: true});
      if (!ctx) return;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cw, ch);

      const mLeft = Math.round(settings.marginLeftMm * pxPerMm);
      const mRight = Math.round(settings.marginRightMm * pxPerMm);
      const mTop = Math.round(settings.marginTopMm * pxPerMm);
      const mBottom = Math.round(settings.marginBottomMm * pxPerMm);

      const printW = Math.max(10, cw - mLeft - mRight);
      const printH = Math.max(10, ch - mTop - mBottom);

      if (page && page.items.length > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(mLeft, mTop, printW, printH);
        ctx.clip();

        let cols = 1;
        let rows = 1;
        if (settings.imagesPerPage === 2) {
          if (dims.widthMm >= dims.heightMm) {
            cols = 2;
          } else {
            rows = 2;
          }
        } else if (settings.imagesPerPage === 4) {
          cols = 2;
          rows = 2;
        }

        const gap = settings.imagesPerPage > 1 ? Math.round(4 * pxPerMm) : 0;
        const cellW = (printW - gap * (cols - 1)) / cols;
        const cellH = (printH - gap * (rows - 1)) / rows;

        for (let i = 0; i < page.items.length; i++) {
          const item = page.items[i];
          const col = i % cols;
          const row = Math.floor(i / cols);
          const cellX = mLeft + col * (cellW + gap);
          const cellY = mTop + row * (cellH + gap);

          try {
            const img = await loadImage(item);
            const rot90 = item.rotation === 90 || item.rotation === 270;
            const srcW = rot90 ? img.naturalHeight : img.naturalWidth;
            const srcH = rot90 ? img.naturalWidth : img.naturalHeight;

            let drawW = cellW;
            let drawH = cellH;

            if (settings.fitMode === 'contain') {
              const scale = Math.min(cellW / srcW, cellH / srcH);
              drawW = srcW * scale;
              drawH = srcH * scale;
            } else if (settings.fitMode === 'cover') {
              const scale = Math.max(cellW / srcW, cellH / srcH);
              drawW = srcW * scale;
              drawH = srcH * scale;
            }

            ctx.save();
            ctx.beginPath();
            ctx.rect(cellX, cellY, cellW, cellH);
            ctx.clip();
            ctx.translate(cellX + cellW / 2, cellY + cellH / 2);
            ctx.rotate((item.rotation * Math.PI) / 180);

            if (rot90) {
              ctx.drawImage(img, -drawH / 2, -drawW / 2, drawH, drawW);
            } else {
              ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
            }
            ctx.restore();
          } catch {
            // Skip unreadable image
          }
        }
        ctx.restore();
      }

      // Enforce Brother HL-1201 4.2 mm hardware edge clamp
      const hwBorder = Math.round(BROTHER_HL1201_USB.minMarginMm * pxPerMm);
      if (hwBorder > 0) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cw, hwBorder);
        ctx.fillRect(0, ch - hwBorder, cw, hwBorder);
        ctx.fillRect(0, 0, hwBorder, ch);
        ctx.fillRect(cw - hwBorder, 0, hwBorder, ch);
      }

      // Convert to 1-bit monochrome laser output
      const imgData = ctx.getImageData(0, 0, cw, ch);
      convertToMonochromeLaser(imgData);
      ctx.putImageData(imgData, 0, 0);

      // Draw margin boundary on preview only
      if (drawMarginGuide) {
        ctx.save();
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(mLeft, mTop, printW, printH);
        ctx.restore();
      }
    },
    [settings, loadImage]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderPageToCanvas(canvas, pages[activePageIndex], 3.5, true);
  }, [pages, activePageIndex, settings, renderPageToCanvas]);

  const handleSelectFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    Array.from(fileList).forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        if (!dataUrl) return;
        const img = new Image();
        img.onload = () => {
          const item: ImageItem = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: file.name,
            dataUrl,
            width: img.naturalWidth,
            height: img.naturalHeight,
            selected: true,
            rotation: 0,
          };
          imageCacheRef.current.set(item.id, img);
          setFiles((prev) => [...prev, item]);
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  };

  const handleConnectUsbOtg = async () => {
    setStatusMessage('');
    const nav = navigator as Navigator & {
      usb?: {
        requestDevice(opts: {
          filters: Array<{vendorId?: number; classCode?: number}>;
        }): Promise<WebUsbDevice>;
      };
    };

    if (!nav.usb) {
      setStatusMessage(
        'Install the Android APK on your mobile/tablet for direct USB OTG hardware access.'
      );
      return;
    }

    try {
      const device = await nav.usb.requestDevice({
        filters: [{vendorId: BROTHER_HL1201_USB.vendorId}, {classCode: 7}],
      });
      await device.open();
      if (!device.configuration) {
        await device.selectConfiguration(1);
      }
      await device.claimInterface(0);
      setUsbDevice(device);
      setStatusMessage(
        `Connected: ${device.productName || 'Brother HL-1201'}`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'USB connection failed';
      setStatusMessage(msg);
    }
  };

  const handlePrint = async () => {
    if (pages.length === 0) return;
    setIsPrinting(true);
    setStatusMessage('Preparing pages...');

    try {
      const offscreen = document.createElement('canvas');
      const bitmaps: ImageData[] = [];
      const urls: string[] = [];

      // Render at 11.81 px/mm (300 DPI raster base) for fast mobile memory handling
      for (const page of pages) {
        await renderPageToCanvas(offscreen, page, 11.811, false);
        const ctx = offscreen.getContext('2d');
        if (ctx) {
          bitmaps.push(
            ctx.getImageData(0, 0, offscreen.width, offscreen.height)
          );
          urls.push(offscreen.toDataURL('image/png'));
        }
      }

      if (usbDevice) {
        setStatusMessage('Sending to Brother HL-1201 over USB OTG...');
        const payload = encodeBrotherHl1201Job(bitmaps, settings);
        const endpoints =
          usbDevice.configuration?.interfaces[0]?.alternates[0]?.endpoints || [];
        const outEp = endpoints.find((e) => e.direction === 'out');
        const epNum = outEp ? outEp.endpointNumber : 1;

        const chunkSize = 16384;
        for (let i = 0; i < payload.length; i += chunkSize) {
          await usbDevice.transferOut(
            epNum,
            payload.slice(i, i + chunkSize)
          );
        }
        setStatusMessage(`Printed ${totalSheetsToPrint} page(s) via USB OTG.`);
      } else {
        const copies = Math.max(1, settings.copies || 1);
        const expanded: string[] = [];
        for (let c = 0; c < copies; c++) {
          expanded.push(...urls);
        }
        setPrintDataUrls(expanded);
        setStatusMessage('');
        setTimeout(() => {
          window.print();
        }, 200);
      }
    } catch (err: unknown) {
      setStatusMessage(
        err instanceof Error ? err.message : 'Print failed.'
      );
    } finally {
      setIsPrinting(false);
    }
  };

  const setMargin = (
    key: 'marginTopMm' | 'marginRightMm' | 'marginBottomMm' | 'marginLeftMm',
    value: number
  ) => {
    const clamped = Math.max(0, Math.min(50, Number(value.toFixed(1))));
    setSettings((prev) => ({...prev, [key]: clamped}));
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <style>{`
        @media print {
          @page {
            size: ${widthMm}mm ${heightMm}mm;
            margin: 0mm;
          }
        }
      `}</style>

      {/* Print-Only Output */}
      <div className="hidden print-only-container">
        {printDataUrls.map((url, i) => (
          <div
            key={i}
            className="print-sheet-page"
            style={{width: `${widthMm}mm`, height: `${heightMm}mm`}}
          >
            <img
              src={url}
              alt={`Page ${i + 1}`}
              referrerPolicy="no-referrer"
              className="w-full h-full object-contain block"
            />
          </div>
        ))}
      </div>

      {/* Header */}
      <header className="no-print flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 bg-white border-b border-slate-200">
        <span className="font-display text-base font-bold text-slate-900 whitespace-nowrap">
          Brother HL-1201 USB OTG Print
        </span>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/api/download-apk"
            download="Brother-HL1201-Print.apk"
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Download APK
          </a>

          <button
            type="button"
            onClick={handleConnectUsbOtg}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <Usb className="w-3.5 h-3.5" />
            {usbDevice ? 'USB Connected' : 'Connect USB OTG'}
          </button>

          <button
            type="button"
            disabled={pages.length === 0 || isPrinting}
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            {isPrinting
              ? 'Printing...'
              : `Print (${totalSheetsToPrint} Page${
                  totalSheetsToPrint === 1 ? '' : 's'
                })`}
          </button>
        </div>
      </header>

      {statusMessage && (
        <div className="no-print bg-slate-900 text-white px-5 py-2 text-xs font-mono">
          {statusMessage}
        </div>
      )}

      {/* Main Content */}
      <main className="no-print flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Controls: Images + Page Setup */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          {/* 1. Images */}
          <section className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display text-sm font-bold text-slate-900">
                Images ({selectedFilesCount} selected)
              </h2>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                Select Images
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  handleSelectFiles(e.target.files);
                  e.target.value = '';
                }}
                className="hidden"
              />
            </div>

            {files.length === 0 ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border border-dashed border-slate-300 rounded-lg p-6 text-center cursor-pointer hover:border-slate-500 transition-colors"
              >
                <p className="text-xs font-medium text-slate-600">
                  Tap to select one or more images
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 max-h-60 overflow-y-auto">
                {files.map((file) => (
                  <div
                    key={file.id}
                    className="py-2 flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <button
                        type="button"
                        onClick={() =>
                          setFiles((prev) =>
                            prev.map((f) =>
                              f.id === file.id
                                ? {...f, selected: !f.selected}
                                : f
                            )
                          )
                        }
                        className="text-slate-800 shrink-0 cursor-pointer"
                      >
                        {file.selected ? (
                          <CheckSquare className="w-4 h-4" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-400" />
                        )}
                      </button>

                      <img
                        src={file.dataUrl}
                        alt={file.name}
                        referrerPolicy="no-referrer"
                        className="w-8 h-8 rounded border border-slate-200 object-cover shrink-0"
                      />

                      <span className="text-xs font-medium text-slate-800 truncate">
                        {file.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setFiles((prev) =>
                            prev.map((f) =>
                              f.id === file.id
                                ? {
                                    ...f,
                                    rotation: ((f.rotation + 90) % 360) as
                                      | 0
                                      | 90
                                      | 180
                                      | 270,
                                  }
                                : f
                            )
                          )
                        }
                        className="p-1.5 text-slate-600 hover:bg-slate-100 rounded cursor-pointer"
                        title="Rotate 90°"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setFiles((prev) =>
                            prev.filter((f) => f.id !== file.id)
                          )
                        }
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded cursor-pointer"
                        title="Remove"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 2. Page Size, Margins & Copies */}
          <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-4 text-xs">
            <h2 className="font-display text-sm font-bold text-slate-900">
              Page &amp; Margin Setup
            </h2>

            {/* Page Size */}
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Page Size
              </label>
              <select
                value={settings.paperSize}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    paperSize: e.target.value as PaperSizeId,
                  }))
                }
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-medium text-slate-900"
              >
                {Object.values(PAPER_SIZES).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Orientation & Image Fit */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Orientation
                </label>
                <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                  {(['portrait', 'landscape'] as const).map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() =>
                        setSettings((prev) => ({...prev, orientation: o}))
                      }
                      className={`py-1.5 rounded capitalize font-medium cursor-pointer ${
                        settings.orientation === o
                          ? 'bg-white text-slate-900 shadow-xs font-semibold'
                          : 'text-slate-600'
                      }`}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Image Fit
                </label>
                <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
                  {(
                    [
                      ['contain', 'Fit'],
                      ['cover', 'Fill'],
                      ['stretch', 'Stretch'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() =>
                        setSettings((prev) => ({...prev, fitMode: id}))
                      }
                      className={`py-1.5 rounded font-medium cursor-pointer ${
                        settings.fitMode === id
                          ? 'bg-white text-slate-900 shadow-xs font-semibold'
                          : 'text-slate-600'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Margins (mm) */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-medium text-slate-700">
                  Margins (mm)
                </label>
                <span className="text-[11px] text-slate-500 font-mono">
                  Min hardware margin: 4.2 mm
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {(
                  [
                    ['marginTopMm', 'Top'],
                    ['marginBottomMm', 'Bottom'],
                    ['marginLeftMm', 'Left'],
                    ['marginRightMm', 'Right'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <span className="block text-[11px] text-slate-500 mb-1">
                      {label}
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      step={0.5}
                      value={settings[key]}
                      onChange={(e) =>
                        setMargin(key, parseFloat(e.target.value) || 0)
                      }
                      className="w-full px-2 py-1.5 font-mono bg-slate-50 border border-slate-300 rounded tabular-nums"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Images per Page & Copies */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200">
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Images per Page
                </label>
                <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg font-mono">
                  {([1, 2, 4] as const).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() =>
                        setSettings((prev) => ({...prev, imagesPerPage: n}))
                      }
                      className={`py-1.5 rounded font-medium cursor-pointer ${
                        settings.imagesPerPage === n
                          ? 'bg-white text-slate-900 shadow-xs font-semibold'
                          : 'text-slate-600'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Copies (Max 150 Tray)
                </label>
                <input
                  type="number"
                  min={1}
                  max={150}
                  value={settings.copies}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      copies: Math.max(
                        1,
                        Math.min(150, parseInt(e.target.value, 10) || 1)
                      ),
                    }))
                  }
                  className="w-full px-2.5 py-1.5 font-mono bg-slate-50 border border-slate-300 rounded tabular-nums"
                />
              </div>
            </div>

            {/* Page Count Summary */}
            <div className="pt-3 border-t border-slate-200 flex items-center justify-between font-mono text-xs tabular-nums">
              <span>
                Pages: <strong>{pages.length}</strong> × Copies:{' '}
                <strong>{settings.copies}</strong>
              </span>
              <span>
                Total Sheets: <strong>{totalSheetsToPrint}</strong> / 150 tray
              </span>
            </div>
          </section>
        </div>

        {/* Right Preview */}
        <div className="lg:col-span-7">
          <section className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-mono text-slate-600 tabular-nums">
                {settings.paperSize} ({widthMm} × {heightMm} mm)
              </div>

              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg font-mono text-xs tabular-nums">
                <button
                  type="button"
                  disabled={activePageIndex <= 0}
                  onClick={() =>
                    setPageIndex(Math.max(0, activePageIndex - 1))
                  }
                  className="p-1 text-slate-700 hover:bg-white rounded disabled:opacity-30 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-2 font-medium">
                  Page {pages.length === 0 ? 0 : activePageIndex + 1} of{' '}
                  {pages.length}
                </span>
                <button
                  type="button"
                  disabled={activePageIndex >= pages.length - 1}
                  onClick={() =>
                    setPageIndex(
                      Math.min(pages.length - 1, activePageIndex + 1)
                    )
                  }
                  className="p-1 text-slate-700 hover:bg-white rounded disabled:opacity-30 cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="bg-slate-900 rounded-lg p-5 flex items-center justify-center min-h-[460px]">
              <canvas
                ref={canvasRef}
                className="block max-w-full h-auto max-h-[500px] bg-white shadow-lg"
              />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
