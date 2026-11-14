import {NextResponse} from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  const apkPath = path.join(process.cwd(), 'public', 'Brother-HL1201-Print.apk');

  if (!fs.existsSync(apkPath)) {
    return new NextResponse('APK file not found', {status: 404});
  }

  const fileBuffer = fs.readFileSync(apkPath);

  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': 'attachment; filename="Brother-HL1201-Print.apk"',
      'Content-Length': String(fileBuffer.length),
      'Cache-Control': 'no-store',
    },
  });
}
