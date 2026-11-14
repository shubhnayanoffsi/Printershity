import {NextResponse} from 'next/server';
import {execFileSync} from 'child_process';
import fs from 'fs';
import path from 'path';

const REPO_OWNER = 'shubhnayanoffsi';
const REPO_NAME = 'Printify';
const TAG_NAME = 'v1.0.0';

export async function POST() {
  const token = process.env.GITHUB_TOKEN?.trim();

  if (!token) {
    return NextResponse.json(
      {
        error:
          'GITHUB_TOKEN is not configured. Add your GitHub Personal Access Token (with repo permission) as GITHUB_TOKEN in the AI Studio Secrets panel, then click Publish again.',
      },
      {status: 400}
    );
  }

  const apkPath = path.join(process.cwd(), 'public', 'Brother-HL1201-Print.apk');
  if (!fs.existsSync(apkPath)) {
    return NextResponse.json(
      {error: 'Compiled APK file not found at public/Brother-HL1201-Print.apk'},
      {status: 404}
    );
  }

  try {
    // 1. Push main branch to https://github.com/shubhnayanoffsi/Printify.git
    const remoteUrl = `https://x-access-token:${token}@github.com/${REPO_OWNER}/${REPO_NAME}.git`;
    execFileSync('git', ['push', remoteUrl, 'HEAD:refs/heads/main', '--force'], {
      cwd: process.cwd(),
      stdio: 'pipe',
    });

    // 2. Check if release v1.0.0 already exists or create it
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Printify-HL1201-Release-Publisher',
    };

    let releaseData: {id: number; upload_url: string; html_url: string} | null =
      null;

    const existingRes = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/tags/${TAG_NAME}`,
      {headers}
    );

    if (existingRes.ok) {
      releaseData = await existingRes.json();
    } else {
      const createRes = await fetch(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases`,
        {
          method: 'POST',
          headers: {...headers, 'Content-Type': 'application/json'},
          body: JSON.stringify({
            tag_name: TAG_NAME,
            target_commitish: 'main',
            name: 'Printify v1.0.0 — Brother HL-1201 USB OTG Android APK',
            body: 'Direct USB-A to USB-B + Type-C OTG Android print application (`Brother-HL1201-Print.apk`) for the Brother HL-1201 monochrome laser printer.',
            draft: false,
            prerelease: false,
          }),
        }
      );

      if (!createRes.ok) {
        const errText = await createRes.text();
        return NextResponse.json(
          {error: `GitHub Release creation failed: ${errText}`},
          {status: createRes.status}
        );
      }
      releaseData = await createRes.json();
    }

    if (!releaseData) {
      return NextResponse.json(
        {error: 'Could not resolve GitHub release metadata.'},
        {status: 500}
      );
    }

    // 3. Upload Brother-HL1201-Print.apk asset to the release
    const uploadUrlBase = releaseData.upload_url.replace(/\{\?.*$/, '');
    const assetName = 'Brother-HL1201-Print.apk';
    const apkBuffer = fs.readFileSync(apkPath);

    // Delete existing asset with same name if present
    const assetsRes = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/${releaseData.id}/assets`,
      {headers}
    );
    if (assetsRes.ok) {
      const assets: Array<{id: number; name: string}> = await assetsRes.json();
      const duplicate = assets.find((a) => a.name === assetName);
      if (duplicate) {
        await fetch(
          `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/assets/${duplicate.id}`,
          {method: 'DELETE', headers}
        );
      }
    }

    const uploadRes = await fetch(
      `${uploadUrlBase}?name=${encodeURIComponent(assetName)}`,
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/vnd.android.package-archive',
          'Content-Length': String(apkBuffer.length),
        },
        body: apkBuffer,
      }
    );

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      return NextResponse.json(
        {error: `APK asset upload failed: ${errText}`},
        {status: uploadRes.status}
      );
    }

    return NextResponse.json({
      ok: true,
      releaseUrl: releaseData.html_url,
    });
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : 'Failed to push and publish release';
    // Never leak token in error output
    const safeMsg = msg.replace(/x-access-token:[^@]+@/g, 'x-access-token:***@');
    return NextResponse.json({error: safeMsg}, {status: 500});
  }
}
