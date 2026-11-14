export type PaperSizeId =
  | 'A4'
  | 'Letter'
  | 'Legal'
  | 'Folio'
  | 'A5'
  | 'B5'
  | 'Executive';

export interface PaperSizeSpec {
  id: PaperSizeId;
  label: string;
  widthMm: number;
  heightMm: number;
  pjlCode: string;
}

export const BROTHER_HL1201_USB = {
  vendorId: 0x04f9, // Brother Industries, Ltd.
  productIds: [0x0062, 0x0054, 0x0065, 0x0330],
  minMarginMm: 4.2, // Physical laser drum edge limit
  maxTraySheets: 150,
  maxOutputSheets: 50,
} as const;

export const PAPER_SIZES: Record<PaperSizeId, PaperSizeSpec> = {
  A4: {
    id: 'A4',
    label: 'A4 (210 × 297 mm)',
    widthMm: 210,
    heightMm: 297,
    pjlCode: 'A4',
  },
  Letter: {
    id: 'Letter',
    label: 'Letter (215.9 × 279.4 mm)',
    widthMm: 215.9,
    heightMm: 279.4,
    pjlCode: 'LETTER',
  },
  Legal: {
    id: 'Legal',
    label: 'Legal (215.9 × 355.6 mm)',
    widthMm: 215.9,
    heightMm: 355.6,
    pjlCode: 'LEGAL',
  },
  Folio: {
    id: 'Folio',
    label: 'Folio (215.9 × 330.2 mm)',
    widthMm: 215.9,
    heightMm: 330.2,
    pjlCode: 'FOLIO',
  },
  A5: {
    id: 'A5',
    label: 'A5 (148 × 210 mm)',
    widthMm: 148,
    heightMm: 210,
    pjlCode: 'A5',
  },
  B5: {
    id: 'B5',
    label: 'B5 (182 × 257 mm)',
    widthMm: 182,
    heightMm: 257,
    pjlCode: 'B5',
  },
  Executive: {
    id: 'Executive',
    label: 'Executive (184.2 × 266.7 mm)',
    widthMm: 184.2,
    heightMm: 266.7,
    pjlCode: 'EXECUTIVE',
  },
};

export interface PrintSettings {
  paperSize: PaperSizeId;
  orientation: 'portrait' | 'landscape';
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  fitMode: 'contain' | 'cover' | 'stretch';
  imagesPerPage: 1 | 2 | 4;
  copies: number;
}

export interface ImageItem {
  id: string;
  name: string;
  dataUrl: string;
  width: number;
  height: number;
  selected: boolean;
  rotation: 0 | 90 | 180 | 270;
}

export interface PageSheet {
  pageNumber: number;
  items: ImageItem[];
}

export function getSheetDimensions(settings: PrintSettings): {
  widthMm: number;
  heightMm: number;
  pjlPaper: string;
} {
  const spec = PAPER_SIZES[settings.paperSize];
  if (settings.orientation === 'landscape') {
    return {
      widthMm: spec.heightMm,
      heightMm: spec.widthMm,
      pjlPaper: spec.pjlCode,
    };
  }
  return {
    widthMm: spec.widthMm,
    heightMm: spec.heightMm,
    pjlPaper: spec.pjlCode,
  };
}

export function buildPages(
  files: ImageItem[],
  settings: PrintSettings
): PageSheet[] {
  const selected = files.filter((f) => f.selected);
  const pages: PageSheet[] = [];
  const perPage = settings.imagesPerPage;

  for (let i = 0; i < selected.length; i += perPage) {
    pages.push({
      pageNumber: pages.length + 1,
      items: selected.slice(i, i + perPage),
    });
  }
  return pages;
}

/**
 * Converts RGBA canvas ImageData into crisp 1-bit monochrome laser pixels
 * using Atkinson error diffusion for the Brother HL-1201 600 DPI engine.
 */
export function convertToMonochromeLaser(imageData: ImageData): void {
  const {width, height, data} = imageData;
  const lum = new Float32Array(width * height);

  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const alpha = data[idx + 3] / 255;
    const r = data[idx] * alpha + 255 * (1 - alpha);
    const g = data[idx + 1] * alpha + 255 * (1 - alpha);
    const b = data[idx + 2] * alpha + 255 * (1 - alpha);
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      const oldPixel = lum[i];
      const newPixel = oldPixel < 128 ? 0 : 255;
      const err = (oldPixel - newPixel) * 0.125;

      if (x + 1 < width) lum[i + 1] += err;
      if (x + 2 < width) lum[i + 2] += err;
      if (y + 1 < height) {
        if (x - 1 >= 0) lum[i + width - 1] += err;
        lum[i + width] += err;
        if (x + 1 < width) lum[i + width + 1] += err;
      }
      if (y + 2 < height) {
        lum[i + width * 2] += err;
      }

      const rgba = i * 4;
      data[rgba] = newPixel;
      data[rgba + 1] = newPixel;
      data[rgba + 2] = newPixel;
      data[rgba + 3] = 255;
    }
  }
}

/**
 * Encodes 1-bit monochrome page bitmaps into a Brother HL-1201
 * PJL + PackBits RLE raster print stream for direct USB Bulk-OUT transfer.
 */
export function encodeBrotherHl1201Job(
  pageBitmaps: ImageData[],
  settings: PrintSettings
): Uint8Array {
  const {pjlPaper} = getSheetDimensions(settings);
  const copies = Math.max(1, Math.min(150, settings.copies || 1));

  const encoder = new TextEncoder();
  const header = encoder.encode(
    [
      '\x1b%-12345X@PJL JOB NAME="HL1201_USB_OTG"',
      '@PJL SET RESOLUTION = 600',
      '@PJL SET ECONOMODE = OFF',
      '@PJL SET MEDIATYPE = REGULAR',
      '@PJL SET SOURCETRAY = AUTO',
      `@PJL SET PAPER = ${pjlPaper}`,
      `@PJL SET ORIENTATION = ${settings.orientation.toUpperCase()}`,
      `@PJL SET COPIES = ${copies}`,
      '@PJL ENTER LANGUAGE = PCL',
      '',
    ].join('\r\n')
  );

  const footer = encoder.encode('\x1b%-12345X@PJL EOJ\r\n\x1b%-12345X');
  const chunks: Uint8Array[] = [header];
  let totalLength = header.length + footer.length;

  for (const bmp of pageBitmaps) {
    const width = bmp.width;
    const height = bmp.height;
    const bytesPerRow = Math.ceil(width / 8);
    const rowBytes = new Uint8Array(bytesPerRow);
    const out: number[] = [];

    const initCmd = '\x1bE\x1b*t600R\x1b*r1A';
    for (let c = 0; c < initCmd.length; c++) {
      out.push(initCmd.charCodeAt(c));
    }

    for (let y = 0; y < height; y++) {
      rowBytes.fill(0);
      const yOffset = y * width;
      let hasBlack = false;

      for (let x = 0; x < width; x++) {
        if (bmp.data[(yOffset + x) * 4] < 128) {
          rowBytes[x >> 3] |= 0x80 >> (x & 7);
          hasBlack = true;
        }
      }

      if (!hasBlack) {
        out.push(0xff);
        continue;
      }

      const rle: number[] = [];
      let i = 0;
      while (i < bytesPerRow) {
        let run = 1;
        while (
          i + run < bytesPerRow &&
          run < 128 &&
          rowBytes[i + run] === rowBytes[i]
        ) {
          run++;
        }
        if (run > 2) {
          rle.push((257 - run) & 0xff, rowBytes[i]);
          i += run;
        } else {
          const start = i;
          let lit = 0;
          while (i < bytesPerRow && lit < 128) {
            if (
              i + 2 < bytesPerRow &&
              rowBytes[i] === rowBytes[i + 1] &&
              rowBytes[i] === rowBytes[i + 2]
            ) {
              break;
            }
            i++;
            lit++;
          }
          rle.push((lit - 1) & 0xff);
          for (let k = 0; k < lit; k++) {
            rle.push(rowBytes[start + k]);
          }
        }
      }

      const cmd = `\x1b*b${rle.length}W`;
      for (let c = 0; c < cmd.length; c++) {
        out.push(cmd.charCodeAt(c));
      }
      for (let c = 0; c < rle.length; c++) {
        out.push(rle[c]);
      }
    }

    const endCmd = '\x1b*rC\x0c';
    for (let c = 0; c < endCmd.length; c++) {
      out.push(endCmd.charCodeAt(c));
    }

    const pageArr = new Uint8Array(out);
    chunks.push(pageArr);
    totalLength += pageArr.length;
  }

  chunks.push(footer);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
