import { env } from "cloudflare:workers";

export function getFilesBucket(): R2Bucket {
  const runtimeEnv = env as typeof env & { FILES?: R2Bucket };
  if (!runtimeEnv.FILES) {
    throw new Error(
      "O armazenamento local de arquivos está indisponível. Reinicie o sistema e tente novamente.",
    );
  }
  return runtimeEnv.FILES;
}
