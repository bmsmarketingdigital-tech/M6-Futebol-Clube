export const PAYMENT_TRANSACTION_TRIGGER_SQL = [
  `CREATE TRIGGER IF NOT EXISTS payment_transactions_immutable_update
   BEFORE UPDATE ON payment_transactions BEGIN
     SELECT RAISE(ABORT,'Transações financeiras são imutáveis.');
   END`,
  `CREATE TRIGGER IF NOT EXISTS payment_transactions_immutable_delete
   BEFORE DELETE ON payment_transactions BEGIN
     SELECT RAISE(ABORT,'Transações financeiras são imutáveis.');
   END`,
  `CREATE TRIGGER IF NOT EXISTS payment_transactions_validate_insert
   BEFORE INSERT ON payment_transactions BEGIN
     SELECT CASE WHEN NEW.type='opening_balance'
       THEN RAISE(ABORT,'Opening balance só pode ser criado pela migração inicial.') END;
     SELECT CASE WHEN NEW.type='payment'
       AND NOT EXISTS(SELECT 1 FROM payment_transactions WHERE idempotency_key=NEW.idempotency_key)
       AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.id=NEW.payment_id
         AND p.status IN ('open','overdue','partial')
         AND p.amount_cents-COALESCE(p.paid_amount_cents,0)>=NEW.amount_cents)
       THEN RAISE(ABORT,'Pagamento inválido, duplicado ou acima do saldo.') END;
     SELECT CASE WHEN NEW.type='refund'
       AND NOT EXISTS(SELECT 1 FROM payment_transactions WHERE idempotency_key=NEW.idempotency_key)
       AND NOT EXISTS(SELECT 1 FROM payment_transactions original JOIN payments p ON p.id=original.payment_id
         WHERE original.id=NEW.reverses_transaction_id AND original.payment_id=NEW.payment_id
           AND original.type IN ('payment','opening_balance')
           AND NEW.amount_cents<=COALESCE(p.paid_amount_cents,0)
           AND NEW.amount_cents<=original.amount_cents-COALESCE((SELECT SUM(previous.amount_cents)
             FROM payment_transactions previous WHERE previous.type='refund'
             AND previous.reverses_transaction_id=original.id),0))
       THEN RAISE(ABORT,'Estorno inválido ou superior ao valor reversível.') END;
   END`,
  `CREATE TRIGGER IF NOT EXISTS payment_transactions_apply_insert
   AFTER INSERT ON payment_transactions WHEN NEW.type IN ('payment','refund') BEGIN
     UPDATE payments SET
       paid_amount_cents=COALESCE(paid_amount_cents,0)+CASE WHEN NEW.type='payment' THEN NEW.amount_cents ELSE -NEW.amount_cents END,
       status=CASE
         WHEN COALESCE(paid_amount_cents,0)+CASE WHEN NEW.type='payment' THEN NEW.amount_cents ELSE -NEW.amount_cents END=amount_cents THEN 'paid'
         WHEN COALESCE(paid_amount_cents,0)+CASE WHEN NEW.type='payment' THEN NEW.amount_cents ELSE -NEW.amount_cents END>0 THEN 'partial'
         WHEN due_date<date('now','localtime') THEN 'overdue' ELSE 'open' END,
       paid_at=CASE WHEN NEW.type='payment' THEN NEW.occurred_at
         WHEN COALESCE(paid_amount_cents,0)-NEW.amount_cents=0 THEN NULL ELSE paid_at END,
       payment_method=CASE WHEN NEW.type='payment' THEN NEW.payment_method
         WHEN COALESCE(paid_amount_cents,0)-NEW.amount_cents=0 THEN NULL ELSE payment_method END,
       notes=CASE WHEN NEW.note IS NULL OR NEW.note='' THEN notes ELSE substr(
         CASE WHEN notes IS NULL OR notes='' THEN NEW.note ELSE notes||char(10)||NEW.note END,-1000) END,
       updated_at=NEW.created_at WHERE id=NEW.payment_id;
     UPDATE athletes SET financial_status=CASE WHEN EXISTS(
       SELECT 1 FROM payments debt WHERE debt.athlete_id=athletes.id
         AND debt.organization_id=athletes.organization_id
         AND debt.status IN ('open','overdue','partial')
         AND debt.amount_cents-COALESCE(debt.paid_amount_cents,0)>0)
       THEN 'pending' ELSE 'paid' END, updated_at=NEW.created_at
       WHERE id=(SELECT athlete_id FROM payments WHERE id=NEW.payment_id);
   END`,
] as const;
