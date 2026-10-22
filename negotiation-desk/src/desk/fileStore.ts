// desk/fileStore.ts — файлы, загруженные «с устройства».
//
// Сообщение хранит только имена (контракт `files: string[]`), а сами File
// объекты держим здесь — они нужны для выгрузки в папку при сохранении чата
// в Word. Живут в памяти вкладки: после перезагрузки имена остаются в
// переписке, содержимое — нет (до связи с основным проектом).

const store = new Map<string, File>();

let seq = 0;

export function registerFile(file: File): string {
  const key = `f-${Date.now().toString(36)}-${(seq += 1)}`;
  store.set(key, file);
  return key;
}

/** Найти последний загруженный файл с таким именем. */
export function findFileByName(name: string): File | null {
  let found: File | null = null;
  for (const file of store.values()) {
    if (file.name === name) found = file;
  }
  return found;
}

export function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round((bytes / 1024) * 10) / 10} КБ`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} МБ`;
}
