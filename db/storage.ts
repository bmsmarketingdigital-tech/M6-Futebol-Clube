type FilesBucket = {
  get: (key: string) => Promise<unknown>;
  put: (key: string, value: unknown, options?: unknown) => Promise<unknown>;
  delete: (key: string) => Promise<unknown>;
};

function readRuntimeFilesBucket() {
  if (typeof globalThis === "undefined") return undefined;
  const runtime = globalThis as typeof globalThis & {
    __env?: { FILES?: FilesBucket };
  };
  return runtime.__env?.FILES;
}

export function getFilesBucket(): FilesBucket {
  const bucket = readRuntimeFilesBucket();
  if (!bucket) {
    throw new Error(
      "O armazenamento de arquivos ainda nÃ£o estÃ¡ configurado neste ambiente.",
    );
  }
  return bucket;
}
