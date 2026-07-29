import { env } from "cloudflare:workers";

export function getFilesBucket(): R2Bucket {
  const runtimeEnv = env as typeof env & { FILES?: R2Bucket };
  if (!runtimeEnv.FILES) {
    throw new Error(
      "Cloudflare R2 binding `FILES` is unavailable. Set the `r2` field in .openai/hosting.json to `FILES`.",
    );
  }
  return runtimeEnv.FILES;
}
