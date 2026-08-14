function unavailable() {
  throw new Error(
    "Cloudflare D1 binding indisponível no runtime Vercel. Migre esta rota para Supabase/Postgres antes de usar em produção.",
  );
}

export const env = {
  get DB(): never {
    return unavailable();
  },
  get FILES(): never {
    return unavailable();
  },
};
