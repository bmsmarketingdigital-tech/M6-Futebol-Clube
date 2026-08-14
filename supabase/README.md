# Migração para Supabase

Esta pasta inicia a evolução do sistema M6 Futebol Clube para Vercel + Supabase.

Estado atual:

- O runtime principal ainda usa SQLite/D1 local.
- Esta migration não deve ser aplicada automaticamente pelo app local.
- O objetivo é preparar o banco Postgres/Supabase antes de trocar o runtime.
- O envio WhatsApp em nuvem será feito via Evolution API, mantendo a fila segura `notification_outbox` + `notification_attempts`.

Ordem segura recomendada:

1. Aplicar `supabase/migrations/0001_initial_schema.sql` em um projeto Supabase vazio.
2. Exportar dados do SQLite oficial.
3. Importar dados no Supabase em ambiente de teste.
4. Validar contagens e invariantes financeiros.
5. Criar uma camada de acesso a banco selecionável por ambiente.
6. Rodar o sistema web contra Supabase em modo staging.
7. Configurar `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` e `EVOLUTION_API_INSTANCE` na Vercel.
8. Fazer preflight sem envio.
9. Só depois liberar envio real.

Variáveis esperadas na Vercel:

```txt
DATABASE_URL=
EVOLUTION_API_URL=
EVOLUTION_API_KEY=
EVOLUTION_API_INSTANCE=
ASAAS_API_KEY=
ASAAS_WEBHOOK_TOKEN=
ASAAS_ENVIRONMENT=production
WHATSAPP_FINANCIAL_MAX_PER_RUN=5
WHATSAPP_FINANCIAL_MIN_INTERVAL_MS=3000
```

Observação importante:

O schema mantém campos de data operacional como `bigint` quando hoje são `integer` Unix timestamp no SQLite. Isso evita conversão prematura e reduz risco na primeira migração. Uma limpeza posterior pode transformar esses campos em `timestamptz`, mas não é o primeiro passo seguro.
