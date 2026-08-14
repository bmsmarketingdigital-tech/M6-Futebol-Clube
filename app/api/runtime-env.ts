type RuntimeEnvironment = Record<string, string | undefined>;

export function getRuntimeEnv(): RuntimeEnvironment {
  const nodeEnv =
    typeof process !== "undefined" && process.env
      ? (process.env as RuntimeEnvironment)
      : {};
  const globalEnv =
    typeof globalThis !== "undefined"
      ? (((globalThis as typeof globalThis & { __env?: RuntimeEnvironment }).__env ??
          {}) as RuntimeEnvironment)
      : {};

  return { ...globalEnv, ...nodeEnv };
}

export function getRuntimeEnvValue(name: string) {
  const value = getRuntimeEnv()[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
