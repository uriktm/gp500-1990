/**
 * Zero-dependency static website & game packager for 500cc Grand Prix '90.
 * Bundles deployable browser assets (index.html, style.css, *.js excluding tests/tools,
 * vendor/, and assets/) into dist/gp500-1990-web.zip and prints file count + archive size.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, '..');

function shouldIncludeTopJs(name) {
  if (!name.endsWith('.js') && !name.endsWith('.mjs')) return false;
  if (/^test[_.-]/i.test(name) || /\.test\./i.test(name)) return false;
  if (name === 'server.js') return false;
  return true;
}

function collectFilesRecursive(baseDir, relDir, outList) {
  const fullDir = path.join(baseDir, relDir);
  if (!fs.existsSync(fullDir)) return;
  const entries = fs.readdirSync(fullDir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (entry.name === '.DS_Store' || entry.name === 'Thumbs.db') continue;
    const relPath = path.posix.join(relDir, entry.name);
    if (entry.isDirectory()) {
      collectFilesRecursive(baseDir, relPath, outList);
    } else if (entry.isFile()) {
      outList.push(relPath);
    }
  }
}

export function collectSiteFiles(rootDir = DEFAULT_ROOT) {
  const files = [];
  for (const staticFile of ['index.html', 'style.css']) {
    if (fs.existsSync(path.join(rootDir, staticFile))) {
      files.push(staticFile);
    }
  }

  const rootEntries = fs.readdirSync(rootDir, { withFileTypes: true });
  rootEntries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of rootEntries) {
    if (entry.isFile() && shouldIncludeTopJs(entry.name)) {
      files.push(entry.name);
    }
  }

  collectFilesRecursive(rootDir, 'vendor', files);
  collectFilesRecursive(rootDir, 'assets', files);
  return files;
}

// Pure-JS standard PKZIP builder (DEFLATE via node:zlib) as cross-platform / headless fallback
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function toDosTimeDate(mtime) {
  const d = mtime instanceof Date ? mtime : new Date();
  const dosTime =
    ((d.getHours() & 0x1f) << 11) |
    ((d.getMinutes() & 0x3f) << 5) |
    ((d.getSeconds() >> 1) & 0x1f);
  const year = Math.max(1980, d.getFullYear());
  const dosDate =
    (((year - 1980) & 0x7f) << 9) |
    (((d.getMonth() + 1) & 0x0f) << 5) |
    (d.getDate() & 0x1f);
  return { dosTime, dosDate };
}

function buildZipPureJs(rootDir, relFiles, destZipPath) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const relPath of relFiles) {
    const absPath = path.join(rootDir, relPath);
    const raw = fs.readFileSync(absPath);
    const stat = fs.statSync(absPath);
    const { dosTime, dosDate } = toDosTimeDate(stat.mtime);
    const crc = crc32(raw);

    const compressed = zlib.deflateRawSync(raw, { level: 6 });
    const useDeflate = compressed.length < raw.length;
    const payload = useDeflate ? compressed : raw;
    const method = useDeflate ? 8 : 0;

    const nameBuf = Buffer.from(relPath.replace(/\\/g, '/'), 'utf8');

    // Local file header (30 bytes + name)
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(dosTime, 10);
    lfh.writeUInt16LE(dosDate, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(payload.length, 18);
    lfh.writeUInt32LE(raw.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);

    localParts.push(lfh, nameBuf, payload);

    // Central directory header (46 bytes + name)
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0x0800, 8);
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt16LE(dosTime, 12);
    cdh.writeUInt16LE(dosDate, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(payload.length, 20);
    cdh.writeUInt32LE(raw.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(offset, 42);

    centralParts.push(cdh, nameBuf);
    offset += lfh.length + nameBuf.length + payload.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(relFiles.length, 8);
  eocd.writeUInt16LE(relFiles.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  const zipBuffer = Buffer.concat([...localParts, centralDirBuf, eocd]);
  fs.writeFileSync(destZipPath, zipBuffer);
}

function tryPowerShellCompress(rootDir, relFiles, distDir, destZipPath) {
  const stageDir = path.join(distDir, `_stage_${process.pid}_${Date.now()}`);
  try {
    fs.mkdirSync(stageDir, { recursive: true });
    for (const relPath of relFiles) {
      const src = path.join(rootDir, relPath);
      const dst = path.join(stageDir, relPath);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }

    const psSafeStage = stageDir.replace(/'/g, "''");
    const psSafeZip = destZipPath.replace(/'/g, "''");
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Compress-Archive -Path '${psSafeStage}\\*' -DestinationPath '${psSafeZip}' -Force`
      ],
      { stdio: 'pipe', timeout: 30000 }
    );
    return fs.existsSync(destZipPath) && fs.statSync(destZipPath).size > 22;
  } catch {
    return false;
  } finally {
    try {
      fs.rmSync(stageDir, { recursive: true, force: true, maxRetries: 6, retryDelay: 80 });
    } catch {
      // Ignore transient Windows file-handle locks during staging cleanup
    }
  }
}

export function packageSite({ rootDir = DEFAULT_ROOT, outFile = null, quiet = false } = {}) {
  const distDir = path.join(rootDir, 'dist');
  const destZipPath = outFile ? path.resolve(outFile) : path.join(distDir, 'gp500-1990-web.zip');
  fs.mkdirSync(path.dirname(destZipPath), { recursive: true });

  if (fs.existsSync(destZipPath)) {
    fs.rmSync(destZipPath, { force: true, maxRetries: 5, retryDelay: 50 });
  }

  const files = collectSiteFiles(rootDir);
  if (files.length === 0) {
    throw new Error(`No deployable static files found in ${rootDir}`);
  }

  // Use zero-dependency pure-JS PKZIP builder (fast, deterministic, avoids Windows temp folder locks)
  let method = 'pure-js';
  try {
    buildZipPureJs(rootDir, files, destZipPath);
  } catch (pureErr) {
    if (process.platform === 'win32') {
      const ok = tryPowerShellCompress(rootDir, files, path.dirname(destZipPath), destZipPath);
      if (!ok) throw pureErr;
      method = 'powershell-compress-archive';
    } else {
      throw pureErr;
    }
  }

  const zipStat = fs.statSync(destZipPath);
  if (!quiet) {
    const mb = (zipStat.size / (1024 * 1024)).toFixed(2);
    console.log(
      `Packaged ${files.length} files into ${destZipPath} (${zipStat.size.toLocaleString()} bytes / ${mb} MB) [${method}]`
    );
  }

  return {
    zipPath: destZipPath,
    fileCount: files.length,
    sizeBytes: zipStat.size,
    method,
    files
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  packageSite();
}
