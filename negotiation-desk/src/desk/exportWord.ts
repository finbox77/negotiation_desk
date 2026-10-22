// desk/exportWord.ts — сохранение чата в документ Word на устройство.
//
// Собирается Word-совместимый .doc (HTML, открывается Word/LibreOffice):
// тема, статус, время сохранения, вес, список участников, переписка и папка
// файлов чата. Если браузер даёт доступ к папке (File System Access API),
// рядом с документом создаётся папка «Файлы» с вложениями — суммарно не
// больше 10 МБ. Иначе скачивается только документ.

import { dayLabel, timeOf } from './format';
import { fileSizeLabel, findFileByName } from './fileStore';
import type { DeskMessage, Participant } from './types';
import { statusLabel } from './labels';

export const FILES_LIMIT_BYTES = 10 * 1024 * 1024;

export type WordExportInput = {
  title: string;
  status: string;
  participants: Participant[];
  messages: DeskMessage[];
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: string }) => Promise<FileSystemDirectoryHandle>;
};

type FsWritable = {
  write: (data: Blob | string) => Promise<void>;
  close: () => Promise<void>;
};

type FsFileHandle = {
  createWritable: () => Promise<FsWritable>;
};

type FsDirHandle = {
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<FsDirHandle>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FsFileHandle>;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtml(input: WordExportInput, savedAt: Date, folderName: string, weight: string): string {
  const rows = input.messages
    .map((message) => {
      const time = `${dayLabel(message.createdAt)}, ${timeOf(message.createdAt)}`;
      const files = (message.files ?? [])
        .map((name) => `<div class="file">📎 ${escapeHtml(name)}</div>`)
        .join('');
      const text =
        message.type === 'system'
          ? `<i>${escapeHtml(message.text ?? 'системное событие')}</i>`
          : message.type === 'call_started' || message.type === 'call_ended'
            ? `<i>${escapeHtml(message.text ?? 'звонок')}</i>`
            : escapeHtml(message.text ?? '');
      return `
      <tr>
        <td class="t">${escapeHtml(time)}</td>
        <td class="a">${escapeHtml(message.senderName)}</td>
        <td class="m">${text}${files}</td>
      </tr>`;
    })
    .join('');

  const people = input.participants
    .map(
      (person) => `
      <tr>
        <td>${escapeHtml(person.name)}${person.isInitiator ? ' (инициатор)' : ''}</td>
        <td>${escapeHtml(person.companyName ?? 'без компании')}</td>
        <td>${escapeHtml(statusLabel(person.role))}</td>
        <td>${person.clearanceLevel}</td>
        <td>${person.present ? 'в столе' : 'не в столе'}</td>
      </tr>`,
    )
    .join('');

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>Чат — ${escapeHtml(input.title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
  @page { size: 21cm 29.7cm; margin: 2cm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #17222f; font-size: 11pt; line-height: 1.45; }
  h1 { font-size: 16pt; margin: 0 0 4pt; }
  .meta { color: #5d6d81; font-size: 9.5pt; margin: 0 0 2pt; }
  h2 { font-size: 12pt; margin: 16pt 0 6pt; border-bottom: 1px solid #c9d2dd; padding-bottom: 3pt; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 3pt 5pt; border: 1px solid #dde3ea; vertical-align: top; }
  th { background: #eef2f7; text-align: left; font-size: 9.5pt; }
  td.t { width: 22%; white-space: nowrap; font-size: 9pt; color: #5d6d81; }
  td.a { width: 18%; font-size: 9.5pt; font-weight: 600; }
  td.m { font-size: 10pt; }
  .file { color: #1f4e8c; font-size: 9pt; margin-top: 2pt; }
  .foot { margin-top: 14pt; color: #9aa6b5; font-size: 8.5pt; }
</style>
</head>
<body>
  <h1>Стол переговоров — «${escapeHtml(input.title)}»</h1>
  <p class="meta">Статус: ${escapeHtml(statusLabel(input.status))}</p>
  <p class="meta">Время сохранения: ${escapeHtml(savedAt.toLocaleString('ru-RU'))}</p>
  <p class="meta">Вес: ${escapeHtml(weight)}</p>
  <p class="meta">Папка файлов чата: «${escapeHtml(folderName)}» (не больше 10 МБ)</p>

  <h2>Участники — ${input.participants.length}</h2>
  <table>
    <tr><th>Имя</th><th>Компания</th><th>Роль</th><th>Допуск</th><th>Статус</th></tr>
    ${people}
  </table>

  <h2>Переписка — ${input.messages.length} сообщений</h2>
  <table>
    <tr><th>Время</th><th>Автор</th><th>Сообщение</th></tr>
    ${rows}
  </table>

  <p class="foot">Сохранено из приложения «Стол переговоров» Simonix.</p>
</body>
</html>`;
}

/** Скачать файл в обычном режиме (без доступа к папке). */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function stamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

/**
 * Сохранить чат: документ .doc + папка «Файлы» (до 10 МБ).
 * Возвращает текст-отчёт для тоста.
 */
export async function exportChatToWord(input: WordExportInput): Promise<string> {
  const savedAt = new Date();
  const safeTitle = input.title.replace(/[\\/:*?"<>|]/g, ' ').slice(0, 60).trim() || 'чат';
  const folderName = `Чат — ${safeTitle}`;
  const docName = `Переписка_${stamp(savedAt)}.doc`;

  // Вес считаем итерациями: строка «Вес» сама меняет размер файла.
  let html = buildHtml(input, savedAt, folderName, '…');
  for (let i = 0; i < 4; i += 1) {
    const size = new Blob([html]).size;
    const next = buildHtml(input, savedAt, folderName, fileSizeLabel(size));
    if (next === html) break;
    html = next;
  }

  const docBlob = new Blob([html], { type: 'application/msword' });

  // Файлы вложений: что загружали с устройства — можно записать в папку.
  const wanted: Array<{ name: string; size: number; file: File | null }> = [];
  const seen = new Set<string>();
  for (const message of input.messages) {
    for (const name of message.files ?? []) {
      if (seen.has(name)) continue;
      seen.add(name);
      const file = findFileByName(name);
      wanted.push({ name, size: file?.size ?? 0, file });
    }
  }

  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (typeof picker === 'function') {
    let root: FsDirHandle | null = null;
    try {
      root = (await picker.call(window, { mode: 'readwrite' })) as FsDirHandle;
    } catch {
      return 'Сохранение отменено';
    }
    if (!root) return 'Сохранение отменено';

    const chatDir = await root.getDirectoryHandle(folderName, { create: true });
    const docHandle = await chatDir.getFileHandle(docName, { create: true });
    const docWriter = await docHandle.createWritable();
    await docWriter.write(docBlob);
    await docWriter.close();

    let total = 0;
    let saved = 0;
    let skipped = 0;
    const withContent = wanted.filter((entry) => entry.file !== null);
    if (withContent.length > 0) {
      const filesDir = await chatDir.getDirectoryHandle('Файлы', { create: true });
      for (const entry of withContent) {
        if (total + entry.size > FILES_LIMIT_BYTES) {
          skipped += 1;
          continue;
        }
        const handle = await filesDir.getFileHandle(entry.name, { create: true });
        const writer = await handle.createWritable();
        await writer.write(entry.file as File);
        await writer.close();
        total += entry.size;
        saved += 1;
      }
    }
    const skippedNamed = wanted.filter((e) => e.file === null).length + skipped;
    return `Сохранено: ${docName}, файлов: ${saved}${skippedNamed > 0 ? ` (пропущено: ${skippedNamed})` : ''}`;
  }

  // Старые/мобильные браузеры: просто скачиваем документ.
  downloadBlob(docBlob, docName);
  return `Скачан ${docName}`;
}
