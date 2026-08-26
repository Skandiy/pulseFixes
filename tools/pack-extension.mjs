#!/usr/bin/env node
/**
 * Сборка дистрибутива Trick Plus для установки «как распакованное расширение».
 *
 * Собирает Vue-модуль event-planning, копирует только те файлы, которые нужны
 * Chrome в рантайме, и кладёт результат в dist/:
 *   dist/trick-plus-<version>/      — готовая папка для «Загрузить распакованное»
 *   dist/trick-plus-<version>.zip   — тот же набор одним файлом, для отправки
 *
 * Запуск:
 *   node tools/pack-extension.mjs [--skip-build] [--no-zip] [--out <dir>]
 */

import { spawnSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Что попадает в дистрибутив. Белый список, а не «всё кроме» — так в архив
 * гарантированно не уедут pulse-fix.pem, node_modules, extension-src и прочее.
 */
const INCLUDE = [
    { file: 'manifest.json' },
    { file: 'modules.json' },
    { file: 'background.js' },
    { file: 'content.js' },
    { dir: 'src', exts: ['.js'] },
    { dir: 'scripts', exts: ['.js'] },
    { dir: 'styles', exts: ['.css'] },
    { dir: 'popup', exts: ['.html', '.js', '.css'] },
    { dir: 'icons', exts: ['.png'] },
    { dir: 'assets', exts: ['.js', '.css'] }
];

/** Файлы, появление которых в дистрибутиве — ошибка (приватный ключ и т.п.). */
const FORBIDDEN = [/\.pem$/i, /\.crx$/i, /(^|[\\/])\.env/i, /(^|[\\/])\.git([\\/]|$)/i];

const args = process.argv.slice(2);

function readOption(name) {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

const flags = {
    skipBuild: args.includes('--skip-build'),
    zip: !args.includes('--no-zip'),
    outDir: readOption('--out') ?? 'dist'
};

const log = (msg) => console.log(msg);
const warn = (msg) => console.warn(`  ! ${msg}`);
const fail = (msg) => {
    console.error(`\nОшибка: ${msg}\n`);
    process.exit(1);
};

// ---------------------------------------------------------------- 1. версия

const manifestPath = path.join(ROOT, 'manifest.json');
if (!fs.existsSync(manifestPath)) fail('не найден manifest.json в корне проекта');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const version = manifest.version;
if (!version) fail('в manifest.json нет поля version');

const pkgPath = path.join(ROOT, 'package.json');
if (fs.existsSync(pkgPath)) {
    const pkgVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
    if (pkgVersion && pkgVersion !== version) {
        warn(`версии разошлись: manifest.json = ${version}, package.json = ${pkgVersion} (беру из manifest.json)`);
    }
}

const packageName = `trick-plus-${version}`;
const outRoot = path.resolve(ROOT, flags.outDir);
const stageDir = path.join(outRoot, packageName);
const zipPath = path.join(outRoot, `${packageName}.zip`);

log(`\nTrick Plus ${version} -> ${path.relative(ROOT, outRoot) || '.'}\n`);

// ------------------------------------------------------------------ 2. сборка

if (flags.skipBuild) {
    log('1) Сборка event-planning пропущена (--skip-build)');
} else if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
    warn('node_modules нет — пропускаю сборку. Выполни `npm install`, если нужен свежий event-planning.js');
} else {
    log('1) Сборка event-planning (vite)...');
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const res = spawnSync(npm, ['run', 'build:event-planning'], {
        cwd: ROOT,
        stdio: 'inherit',
        shell: process.platform === 'win32'
    });
    if (res.status !== 0) fail('vite build завершился с ошибкой — дистрибутив не собран');
}

// -------------------------------------------------------- 3. сбор списка файлов

function walk(dir, exts, rel = dir) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return [];
    const out = [];
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const relPath = `${rel}/${entry.name}`;
        if (entry.isDirectory()) {
            out.push(...walk(path.join(dir, entry.name), exts, relPath));
        } else if (!exts || exts.includes(path.extname(entry.name).toLowerCase())) {
            out.push(relPath);
        }
    }
    return out;
}

log('\n2) Сбор файлов...');

const files = [];
for (const rule of INCLUDE) {
    if (rule.file) {
        if (!fs.existsSync(path.join(ROOT, rule.file))) fail(`нет обязательного файла ${rule.file}`);
        files.push(rule.file);
    } else {
        const found = walk(rule.dir, rule.exts);
        if (found.length === 0) warn(`папка ${rule.dir}/ пуста или отсутствует`);
        files.push(...found);
    }
}

for (const file of files) {
    if (FORBIDDEN.some((re) => re.test(file))) fail(`в список попал запрещённый файл: ${file}`);
}

// --------------------------------------------------- 4. проверка целостности

log('3) Проверка ссылок из manifest.json и modules.json...');

const present = new Set(files.map((f) => f.replace(/\\/g, '/')));
const problems = [];
const need = (p, where) => {
    if (p && !present.has(p)) problems.push(`${where}: ${p}`);
};

need(manifest.background?.service_worker, 'manifest.background');
need(manifest.action?.default_popup, 'manifest.action.default_popup');
for (const cs of manifest.content_scripts ?? []) {
    for (const js of cs.js ?? []) need(js, 'manifest.content_scripts');
    for (const css of cs.css ?? []) need(css, 'manifest.content_scripts');
}
for (const icon of Object.values(manifest.icons ?? {})) need(icon, 'manifest.icons');
for (const icon of Object.values(manifest.action?.default_icon ?? {})) need(icon, 'manifest.action.default_icon');

const modulesPath = path.join(ROOT, 'modules.json');
if (fs.existsSync(modulesPath)) {
    const modules = JSON.parse(fs.readFileSync(modulesPath, 'utf8'));
    const flatten = (list) => (list ?? []).map((e) => (typeof e === 'string' ? e : e.value));
    for (const p of flatten(modules.scripts)) need(p, 'modules.json/scripts');
    for (const p of flatten(modules.styles)) need(p, 'modules.json/styles');
}

// pageBridge.js подключается напрямую из src/content-main.js, в modules.json его нет
need('scripts/pageBridge.js', 'src/content-main.js');
if (present.has('scripts/eventPlanning.js')) need('assets/event-planning.js', 'scripts/eventPlanning.js');

if (problems.length) {
    fail(`эти файлы нужны расширению, но не попали в дистрибутив:\n   - ${problems.join('\n   - ')}`);
}

// ------------------------------------------------------------- 5. копирование

log(`4) Копирование в ${path.relative(ROOT, stageDir)}/ ...`);

fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(stageDir, { recursive: true });

let totalBytes = 0;
for (const file of files) {
    const src = path.join(ROOT, file);
    const dest = path.join(stageDir, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    totalBytes += fs.statSync(src).size;
}

const instructions = [
    `Trick Plus ${version} — установка в Chrome`,
    '',
    '1. Распакуйте архив в постоянную папку (не во временную и не в «Загрузки»):',
    '   Chrome читает файлы из этой папки при каждом запуске, удалите её —',
    '   и расширение перестанет работать.',
    '2. Откройте в Chrome адрес: chrome://extensions',
    '3. Включите «Режим разработчика» — переключатель в правом верхнем углу.',
    '4. Нажмите «Загрузить распакованное расширение» и выберите папку,',
    `   в которой лежит manifest.json (папка ${packageName}).`,
    '5. Значок Trick Plus появится на панели расширений — в нём настройки.',
    '',
    'Обновление: распакуйте новую версию поверх старой папки и нажмите',
    'кнопку обновления на карточке расширения в chrome://extensions.',
    '',
    'Расширение работает только на https://pulse.stack-it.ru/',
    ''
].join('\r\n');

fs.writeFileSync(path.join(stageDir, 'КАК-УСТАНОВИТЬ.txt'), '﻿' + instructions, 'utf8');

log(`   ${files.length} файлов, ${(totalBytes / 1024).toFixed(0)} КБ`);

// ------------------------------------------------------------------- 6. zip

if (!flags.zip) {
    log(`\nГотово: ${path.relative(ROOT, stageDir)}/\n`);
    process.exit(0);
}

log('5) Упаковка в zip...');

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[i] = c;
    }
    return table;
})();

function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}

function dosDateTime(date) {
    const year = Math.max(date.getFullYear(), 1980);
    return {
        time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
        date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
}

/** Минимальный zip-writer (store/deflate) — чтобы не тянуть зависимости. */
function zipDirectory(sourceDir, destZip, rootFolderName) {
    const stamp = dosDateTime(new Date());
    const chunks = [];
    const central = [];
    let offset = 0;

    const push = (buf) => {
        chunks.push(buf);
        offset += buf.length;
    };

    const addEntry = (entryName, data, isDir) => {
        const nameBuf = Buffer.from(entryName, 'utf8');
        const raw = isDir ? Buffer.alloc(0) : data;
        const crc = isDir ? 0 : crc32(raw);

        let method = 0;
        let payload = raw;
        if (!isDir && raw.length > 0) {
            const deflated = deflateRawSync(raw, { level: 9 });
            if (deflated.length < raw.length) {
                method = 8;
                payload = deflated;
            }
        }

        const localOffset = offset;
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4); // version needed
        local.writeUInt16LE(0x0800, 6); // флаг «имена в UTF-8»
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(stamp.time, 10);
        local.writeUInt16LE(stamp.date, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(payload.length, 18);
        local.writeUInt32LE(raw.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28); // extra
        push(local);
        push(nameBuf);
        if (payload.length) push(payload);

        const cd = Buffer.alloc(46);
        cd.writeUInt32LE(0x02014b50, 0);
        cd.writeUInt16LE(20, 4); // version made by
        cd.writeUInt16LE(20, 6); // version needed
        cd.writeUInt16LE(0x0800, 8);
        cd.writeUInt16LE(method, 10);
        cd.writeUInt16LE(stamp.time, 12);
        cd.writeUInt16LE(stamp.date, 14);
        cd.writeUInt32LE(crc, 16);
        cd.writeUInt32LE(payload.length, 20);
        cd.writeUInt32LE(raw.length, 24);
        cd.writeUInt16LE(nameBuf.length, 28);
        cd.writeUInt16LE(0, 30); // extra
        cd.writeUInt16LE(0, 32); // comment
        cd.writeUInt16LE(0, 34); // disk
        cd.writeUInt16LE(0, 36); // internal attrs
        cd.writeUInt32LE(isDir ? 0x10 : 0, 38); // external attrs
        cd.writeUInt32LE(localOffset, 42);
        central.push(Buffer.concat([cd, nameBuf]));
    };

    const walkZip = (dir, prefix) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
        for (const entry of entries) {
            const abs = path.join(dir, entry.name);
            const name = `${prefix}${entry.name}`;
            if (entry.isDirectory()) {
                addEntry(`${name}/`, null, true);
                walkZip(abs, `${name}/`);
            } else {
                addEntry(name, fs.readFileSync(abs), false);
            }
        }
    };

    addEntry(`${rootFolderName}/`, null, true);
    walkZip(sourceDir, `${rootFolderName}/`);

    const cdOffset = offset;
    const cdBuf = Buffer.concat(central);
    push(cdBuf);

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(central.length, 8);
    eocd.writeUInt16LE(central.length, 10);
    eocd.writeUInt32LE(cdBuf.length, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    eocd.writeUInt16LE(0, 20);
    push(eocd);

    fs.writeFileSync(destZip, Buffer.concat(chunks));
}

fs.rmSync(zipPath, { force: true });
zipDirectory(stageDir, zipPath, packageName);

const zipSize = fs.statSync(zipPath).size;
log('\nГотово:');
log(`   папка : ${path.relative(ROOT, stageDir)}/  (Chrome -> «Загрузить распакованное»)`);
log(`   архив : ${path.relative(ROOT, zipPath)}  (${(zipSize / 1024).toFixed(0)} КБ) — этот файл отправляй\n`);
