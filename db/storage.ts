type FilesBucket = {
  get: (key: string) => Promise<unknown>;
  put: (key: string, value: unknown, options?: unknown) => Promise<unknown>;
  delete: (key: string) => Promise<unknown>;
};

type StoredObject = {
  body: BodyInit | null;
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

function readSupabaseStorageConfig(source = process.env) {
  const url = source.SUPABASE_URL || source.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = source.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = source.SUPABASE_STORAGE_BUCKET || "athlete-documents";
  if (!url || !serviceRoleKey) return null;
  return {
    url: url.replace(/\/+$/, ""),
    serviceRoleKey,
    bucket,
  };
}

function readContentType(options: unknown) {
  if (
    options &&
    typeof options === "object" &&
    "httpMetadata" in options &&
    options.httpMetadata &&
    typeof options.httpMetadata === "object" &&
    "contentType" in options.httpMetadata &&
    typeof options.httpMetadata.contentType === "string"
  ) {
    return options.httpMetadata.contentType;
  }
  return "application/octet-stream";
}

export function getSupabaseFilesBucket(source = process.env): FilesBucket | null {
  const config = readSupabaseStorageConfig(source);
  if (!config) return null;

  const headers = {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
  };

  return {
    async get(key: string): Promise<StoredObject | null> {
      const response = await fetch(
        `${config.url}/storage/v1/object/${config.bucket}/${encodeURI(key)}`,
        { headers },
      );
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(`Falha ao baixar arquivo no Supabase Storage: ${response.status}`);
      }
      return { body: response.body };
    },
    async put(key: string, value: unknown, options?: unknown) {
      const response = await fetch(
        `${config.url}/storage/v1/object/${config.bucket}/${encodeURI(key)}`,
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": readContentType(options),
            "x-upsert": "false",
          },
          body: value as BodyInit,
        },
      );
      if (!response.ok) {
        throw new Error(`Falha ao enviar arquivo para Supabase Storage: ${response.status}`);
      }
      return response.json().catch(() => ({}));
    },
    async delete(key: string) {
      const response = await fetch(`${config.url}/storage/v1/object/${config.bucket}`, {
        method: "DELETE",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prefixes: [key] }),
      });
      if (!response.ok && response.status !== 404) {
        throw new Error(`Falha ao excluir arquivo no Supabase Storage: ${response.status}`);
      }
      return response.json().catch(() => ({}));
    },
  };
}

export function getConfiguredFilesBucket(): FilesBucket {
  return getSupabaseFilesBucket() ?? getFilesBucket();
}
