export const SHELL_CONCURRENCY = 32;
export const SHELL_TIMEOUT_MS = 120_000;
export const SHELL_TIMEOUT_MAX_MS = 600_000;
export const SHELL_TIMEOUT_MIN_MS = 1_000;
export const OUTPUT_CHAR_LIMIT = 30_000;
// Image `data` skips the text cap. 1_000_000 base64 chars is about 750KB: a readable screenshot preview that still fits one ChatGPT or Claude tool result.
export const IMAGE_BASE64_CHAR_LIMIT = 1_000_000;
export const WRITE_CHAR_LIMIT = 1_000_000;
export const COMMAND_CHAR_LIMIT = 10_000;
export const GLOB_MAX = 200;
export const GREP_MAX_MATCHES = 100;
export const GREP_MAX_FILES = 5_000;
export const GREP_MAX_DEPTH = 20;
export const WEB_FETCH_TIMEOUT_MS = 20_000;
export const WEB_FETCH_MAX_REDIRECTS = 3;
