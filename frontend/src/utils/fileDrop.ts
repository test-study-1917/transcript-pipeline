/** Only OS file drags belong to upload zones; page-internal reorder/text drags do not. */
export function hasFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

export function preventFileNavigation(event: DragEvent) {
  if (!hasFileDrag(event)) return;
  event.preventDefault();
  if (event.type === "dragover" && event.dataTransfer) event.dataTransfer.dropEffect = "none";
}

export function validateDroppedFiles(files: File[], accept: string, multiple: boolean, label: string) {
  if (!files.length) throw new Error("未读取到文件，请拖入本地文件，或使用选择按钮。");
  if (!multiple && files.length !== 1) throw new Error(`${label}每次只能上传一个文件，请分别拖入对应区域。`);
  const rules = accept.toLowerCase().split(",").map(value => value.trim()).filter(Boolean);
  const invalid = files.find(file => rules.length && !rules.some(rule => {
    if (rule.startsWith(".")) return file.name.toLowerCase().endsWith(rule);
    if (rule.endsWith("/*")) return file.type.toLowerCase().startsWith(rule.slice(0, -1));
    return file.type.toLowerCase() === rule;
  }));
  if (invalid) throw new Error(`${invalid.name} 不符合${label}支持的格式（${accept}），请拖入对应的上传区。`);
}

async function readEntry(entry: FileSystemEntry, parent = ""): Promise<File[]> {
  const relativePath = `${parent}${entry.name}`;
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    // Preserve nested paths using the same contract as the directory picker.
    Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
    return [file];
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const files: File[] = [];
  // readEntries returns batches (typically 100); continue until the directory is exhausted.
  while (true) {
    const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!entries.length) return files;
    for (const child of entries) files.push(...await readEntry(child, `${relativePath}/`));
  }
}

export async function filesFromDrop(transfer: DataTransfer, directory: boolean): Promise<File[]> {
  // DataTransfer is protected after the event returns: snapshot every item before awaiting.
  const files = Array.from(transfer.files);
  const entries = Array.from(transfer.items ?? [])
    .filter(item => item.kind === "file")
    .map(item => ({ entry: item.webkitGetAsEntry?.(), file: item.getAsFile() }));
  if (!directory && entries.some(({ entry }) => entry?.isDirectory)) {
    throw new Error("此处只接收文件，请打开文件夹后拖入文件；文件夹请拖到目录上传区。");
  }
  if (!directory || !entries.length) return files;
  const collected: File[] = [];
  for (const { entry, file } of entries) {
    if (entry) collected.push(...await readEntry(entry));
    else if (file) collected.push(file);
  }
  return collected;
}
