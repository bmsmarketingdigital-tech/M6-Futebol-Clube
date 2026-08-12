export const HISTORY_PROTECTION_TRIGGER_SQL = [
  `CREATE TRIGGER IF NOT EXISTS payments_preserve_history_delete
   BEFORE DELETE ON payments BEGIN
     SELECT RAISE(ABORT,'Mensalidades financeiras devem ser canceladas, nunca excluÃ­das.');
   END`,
  `CREATE TRIGGER IF NOT EXISTS athletes_preserve_history_delete
   BEFORE DELETE ON athletes WHEN
     EXISTS(SELECT 1 FROM payments WHERE athlete_id=OLD.id) OR
     EXISTS(SELECT 1 FROM attendance_records WHERE athlete_id=OLD.id) OR
     EXISTS(SELECT 1 FROM athlete_check_ins WHERE athlete_id=OLD.id) OR
     EXISTS(SELECT 1 FROM billing_notifications WHERE athlete_id=OLD.id) OR
     EXISTS(SELECT 1 FROM notification_outbox WHERE athlete_id=OLD.id) OR
     EXISTS(SELECT 1 FROM communication_recipients WHERE athlete_id=OLD.id)
   BEGIN
     SELECT RAISE(ABORT,'Atletas com histÃ³rico devem ser arquivados, nunca excluÃ­dos.');
   END`,
  `CREATE TRIGGER IF NOT EXISTS teams_preserve_history_delete
   BEFORE DELETE ON teams WHEN
     EXISTS(SELECT 1 FROM attendance_sessions WHERE team_id=OLD.id) OR
     EXISTS(SELECT 1 FROM athlete_check_ins WHERE team_id=OLD.id) OR
     EXISTS(SELECT 1 FROM class_reminders WHERE team_id=OLD.id) OR
     EXISTS(SELECT 1 FROM communications WHERE team_id=OLD.id) OR
     EXISTS(SELECT 1 FROM training_sessions WHERE team_id=OLD.id) OR
     EXISTS(SELECT 1 FROM notification_outbox WHERE team_id=OLD.id)
   BEGIN
     SELECT RAISE(ABORT,'Turmas com histÃ³rico devem ser arquivadas, nunca excluÃ­das.');
   END`,
  `CREATE TRIGGER IF NOT EXISTS billing_notifications_preserve_history_delete
   BEFORE DELETE ON billing_notifications WHEN OLD.status IN ('sent','failed') BEGIN
     SELECT RAISE(ABORT,'O histÃ³rico de notificaÃ§Ãµes financeiras nÃ£o pode ser excluÃ­do.');
   END`,
  `CREATE TRIGGER IF NOT EXISTS notification_outbox_preserve_history_delete
   BEFORE DELETE ON notification_outbox WHEN
     OLD.status IN ('sent','failed','delivery_unknown','superseded') OR
     EXISTS(SELECT 1 FROM notification_attempts WHERE notification_id=OLD.id)
   BEGIN
     SELECT RAISE(ABORT,'O histÃ³rico da outbox nÃ£o pode ser excluÃ­do.');
   END`,
  `CREATE TRIGGER IF NOT EXISTS notification_attempts_preserve_history_delete
   BEFORE DELETE ON notification_attempts BEGIN
     SELECT RAISE(ABORT,'Tentativas de notificaÃ§Ã£o sÃ£o registros de auditoria.');
   END`,
  `CREATE TRIGGER IF NOT EXISTS payments_validate_money_insert
   BEFORE INSERT ON payments WHEN NEW.amount_cents<=0 OR COALESCE(NEW.paid_amount_cents,0)<0
     OR COALESCE(NEW.paid_amount_cents,0)>NEW.amount_cents
   BEGIN SELECT RAISE(ABORT,'Valores monetÃ¡rios da mensalidade sÃ£o invÃ¡lidos.'); END`,
  `CREATE TRIGGER IF NOT EXISTS payments_validate_money_update
   BEFORE UPDATE OF amount_cents,paid_amount_cents ON payments
   WHEN NEW.amount_cents<=0 OR COALESCE(NEW.paid_amount_cents,0)<0
     OR COALESCE(NEW.paid_amount_cents,0)>NEW.amount_cents
   BEGIN SELECT RAISE(ABORT,'Valores monetÃ¡rios da mensalidade sÃ£o invÃ¡lidos.'); END`,
  `CREATE TRIGGER IF NOT EXISTS billing_plans_validate_money_insert
   BEFORE INSERT ON billing_plans WHEN NEW.amount_cents<=0
   BEGIN SELECT RAISE(ABORT,'O valor do plano deve ser positivo e em centavos.'); END`,
  `CREATE TRIGGER IF NOT EXISTS billing_plans_validate_money_update
   BEFORE UPDATE OF amount_cents ON billing_plans WHEN NEW.amount_cents<=0
   BEGIN SELECT RAISE(ABORT,'O valor do plano deve ser positivo e em centavos.'); END`,
  `CREATE TRIGGER IF NOT EXISTS expenses_validate_money_insert
   BEFORE INSERT ON expenses WHEN NEW.amount_cents<=0
   BEGIN SELECT RAISE(ABORT,'O valor da despesa deve ser positivo e em centavos.'); END`,
  `CREATE TRIGGER IF NOT EXISTS expenses_validate_money_update
   BEFORE UPDATE OF amount_cents ON expenses WHEN NEW.amount_cents<=0
   BEGIN SELECT RAISE(ABORT,'O valor da despesa deve ser positivo e em centavos.'); END`,
  `CREATE TRIGGER IF NOT EXISTS attendance_records_block_canceled_session_insert
   BEFORE INSERT ON attendance_records WHEN
     EXISTS(SELECT 1 FROM attendance_sessions WHERE id=NEW.session_id AND status='canceled')
   BEGIN
     SELECT RAISE(ABORT,'Não é possível registrar presença em uma aula cancelada.');
   END`,
  `CREATE TRIGGER IF NOT EXISTS attendance_records_block_canceled_session_update
   BEFORE UPDATE ON attendance_records WHEN
     EXISTS(SELECT 1 FROM attendance_sessions WHERE id=NEW.session_id AND status='canceled')
   BEGIN
     SELECT RAISE(ABORT,'Não é possível registrar presença em uma aula cancelada.');
   END`,
] as const;
