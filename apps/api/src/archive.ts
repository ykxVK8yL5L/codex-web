import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ArchiveIgnoreTemplate, FileArchivePreviewResponse } from "@codex-web/protocol";

const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function zipLocalHeader(name: Buffer, crc: number, size: number, date: Date) {
  const { time, day } = dosDateTime(date);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(time, 10);
  header.writeUInt16LE(day, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(size, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, name]);
}

function zipCentralHeader(name: Buffer, crc: number, size: number, date: Date, offset: number) {
  const { time, day } = dosDateTime(date);
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(time, 12);
  header.writeUInt16LE(day, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(size, 20);
  header.writeUInt32LE(size, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, name]);
}

function zipEndRecord(count: number, centralSize: number, centralOffset: number) {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return end;
}

function addZipEntry(parts: { local: Buffer[]; central: Buffer[]; offset: number; count: number }, entryName: string, data: Buffer, modifiedAt = new Date()) {
  const name = Buffer.from(entryName.replace(/^\/+/, ""), "utf8");
  const crc = crc32(data);
  const local = zipLocalHeader(name, crc, data.length, modifiedAt);
  const central = zipCentralHeader(name, crc, data.length, modifiedAt, parts.offset);
  parts.local.push(local, data);
  parts.central.push(central);
  parts.offset += local.length + data.length;
  parts.count += 1;
}

function globToRegExp(pattern: string) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("?", "[^/]")
    .replaceAll("\u0000", ".*");
  return new RegExp(`^${escaped}$`);
}

export function archiveExcluder(patterns: string[]) {
  const rules = patterns.map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  return (relativePath: string, isDirectory: boolean) => {
    const normalized = relativePath.replaceAll("\\", "/").replace(/^\/+/, "");
    const basenameOnly = basename(normalized);
    let excluded = false;
    for (const rawRule of rules) {
      const negated = rawRule.startsWith("!");
      const rule = negated ? rawRule.slice(1).trim() : rawRule;
      if (!rule) continue;
      const anchored = rule.startsWith("/");
      const directoryRule = rule.endsWith("/");
      const cleanRule = rule.replace(/^\/+/, "").replace(/\/+$/, "");
      let matched = false;
      if (directoryRule) {
        if (anchored) {
          matched = normalized === cleanRule || normalized.startsWith(`${cleanRule}/`);
        } else {
          matched = normalized === cleanRule || normalized.endsWith(`/${cleanRule}`) || normalized.includes(`/${cleanRule}/`) || normalized.startsWith(`${cleanRule}/`);
        }
      } else if (cleanRule.includes("/") || cleanRule.includes("*") || cleanRule.includes("?")) {
        matched = anchored
          ? globToRegExp(cleanRule).test(normalized)
          : globToRegExp(cleanRule).test(normalized) || globToRegExp(`**/${cleanRule}`).test(normalized);
      } else {
        matched = basenameOnly === cleanRule || (!isDirectory && normalized.includes(`/${cleanRule}/`));
      }
      if (matched) excluded = !negated;
    }
    return excluded;
  };
}

export function createZipArchive(rootPath: string, baseName: string, excludes: string[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  const shouldExclude = archiveExcluder(excludes);
  let offset = 0;
  let count = 0;

  function addFile(absolutePath: string, entryName: string, modifiedAt: Date) {
    const data = readFileSync(absolutePath);
    const name = Buffer.from(entryName, "utf8");
    const crc = crc32(data);
    const local = zipLocalHeader(name, crc, data.length, modifiedAt);
    const central = zipCentralHeader(name, crc, data.length, modifiedAt, offset);
    localParts.push(local, data);
    centralParts.push(central);
    offset += local.length + data.length;
    count += 1;
  }

  function walk(absolutePath: string, relativePath: string) {
    const stat = lstatSync(absolutePath);
    if (stat.isSymbolicLink()) return;
    const archivePath = relativePath ? `${baseName}/${relativePath}` : baseName;
    if (relativePath && shouldExclude(relativePath, stat.isDirectory())) return;
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolutePath)) walk(join(absolutePath, name), relativePath ? `${relativePath}/${name}` : name);
      return;
    }
    if (!stat.isFile()) return;
    addFile(absolutePath, archivePath, stat.mtime);
  }

  walk(rootPath, "");
  const centralOffset = offset;
  const central = Buffer.concat(centralParts);
  return Buffer.concat([...localParts, central, zipEndRecord(count, central.length, centralOffset)]);
}

export function createZipArchiveWithEntries(entries: Array<{ name: string; data: Buffer | string; modifiedAt?: Date }>) {
  const parts = { local: [] as Buffer[], central: [] as Buffer[], offset: 0, count: 0 };
  for (const entry of entries) addZipEntry(parts, entry.name, Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data), entry.modifiedAt);
  const centralOffset = parts.offset;
  const central = Buffer.concat(parts.central);
  return Buffer.concat([...parts.local, central, zipEndRecord(parts.count, central.length, centralOffset)]);
}

export function parseStoredZipArchive(buffer: Buffer) {
  const entries: Array<{ name: string; data: Buffer }> = [];
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) throw new Error("invalid_zip");
    const method = buffer.readUInt16LE(offset + 8);
    if (method !== 0) throw new Error("unsupported_zip_compression");
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + size;
    if (dataEnd > buffer.length) throw new Error("invalid_zip_entry");
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    entries.push({ name, data: buffer.subarray(dataStart, dataEnd) });
    offset = dataEnd;
  }
  return entries;
}

export function previewZipArchive(rootPath: string, excludes: string[]): FileArchivePreviewResponse {
  const shouldExclude = archiveExcluder(excludes);
  const result: FileArchivePreviewResponse = { files: 0, bytes: 0, excluded: 0, excludedExamples: [] };

  function markExcluded(relativePath: string) {
    result.excluded += 1;
    if (result.excludedExamples.length < 8) result.excludedExamples.push(relativePath);
  }

  function walk(absolutePath: string, relativePath: string) {
    const stat = lstatSync(absolutePath);
    if (stat.isSymbolicLink()) {
      if (relativePath) markExcluded(relativePath);
      return;
    }
    if (relativePath && shouldExclude(relativePath, stat.isDirectory())) {
      markExcluded(relativePath);
      return;
    }
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolutePath)) walk(join(absolutePath, name), relativePath ? `${relativePath}/${name}` : name);
      return;
    }
    if (!stat.isFile()) return;
    result.files += 1;
    result.bytes += stat.size;
  }

  walk(rootPath, "");
  return result;
}

export function listArchiveIgnoreTemplates(archiveIgnoreTemplateDir: string): ArchiveIgnoreTemplate[] {
  if (!existsSync(archiveIgnoreTemplateDir)) return [];
  function walk(dir: string, groupParts: string[] = []): ArchiveIgnoreTemplate[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const filePath = join(dir, entry.name);
      if (entry.isDirectory()) return walk(filePath, [...groupParts, entry.name]);
      if (!entry.isFile() || !/\.(gitignore|ignore|txt)$/i.test(entry.name)) return [];
      const name = entry.name.replace(/\.(gitignore|ignore|txt)$/i, "");
      const group = groupParts.join("/") || "Root";
      const idBase = [...groupParts, name].join("-");
      return [{
        id: idBase.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-"),
        name,
        group,
        rules: readFileSync(filePath, "utf8").trim(),
      }];
    });
  }
  return walk(archiveIgnoreTemplateDir)
    .sort((a, b) => a.group === b.group ? a.name.localeCompare(b.name) : a.group.localeCompare(b.group));
}
