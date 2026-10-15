export function isStructuredDocument(path: string): boolean {
  return /\.(xlsx|xlsm|docx|pdf)$/i.test(path);
}
