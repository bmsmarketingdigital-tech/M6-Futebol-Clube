export const NOTIFICATION_HISTORY_TRIGGER_SQL = [
  `CREATE TRIGGER IF NOT EXISTS billing_notifications_immutable_final_update
   BEFORE UPDATE ON billing_notifications
   WHEN OLD.status IN ('sent','failed')
   BEGIN
     SELECT RAISE(ABORT,'NotificaÃ§Ãµes financeiras finalizadas sÃ£o imutÃ¡veis.');
   END`,
  `CREATE TRIGGER IF NOT EXISTS notification_outbox_immutable_final_update
   BEFORE UPDATE ON notification_outbox
   WHEN (
     OLD.status IN ('sent','superseded','delivery_unknown') OR
     (OLD.status='failed' AND (
       OLD.attempt_count>=OLD.max_attempts OR OLD.event_type='controlled_test'
     ))
   ) AND NOT (
     NEW.id IS OLD.id AND
     NEW.organization_id IS OLD.organization_id AND
     NEW.athlete_id IS OLD.athlete_id AND
     NEW.payment_id IS OLD.payment_id AND
     NEW.team_id IS OLD.team_id AND
     NEW.legacy_notification_id IS OLD.legacy_notification_id AND
     NEW.original_notification_id IS OLD.original_notification_id AND
     NEW.event_type IS OLD.event_type AND
     NEW.idempotency_key IS OLD.idempotency_key AND
     NEW.phone IS OLD.phone AND
     NEW.message IS OLD.message AND
     NEW.status IS OLD.status AND
     NEW.attempt_count IS OLD.attempt_count AND
     NEW.max_attempts IS OLD.max_attempts AND
     NEW.next_attempt_at IS OLD.next_attempt_at AND
     NEW.locked_at IS OLD.locked_at AND
     NEW.locked_until IS OLD.locked_until AND
     NEW.lock_token IS OLD.lock_token AND
     NEW.last_error IS OLD.last_error AND
     NEW.sent_at IS OLD.sent_at AND
     NEW.provider_message_id IS OLD.provider_message_id AND
     NEW.last_attempt_origin IS OLD.last_attempt_origin AND
     NEW.created_at IS OLD.created_at AND
     NEW.manual_resend_count=OLD.manual_resend_count+1 AND
     NEW.updated_at>=OLD.updated_at
   )
   BEGIN
     SELECT RAISE(ABORT,'Itens finalizados da outbox sÃ£o imutÃ¡veis.');
   END`,
  `CREATE TRIGGER IF NOT EXISTS notification_attempts_immutable_final_update
   BEFORE UPDATE ON notification_attempts
   WHEN OLD.finished_at IS NOT NULL OR OLD.status<>'processing'
   BEGIN
     SELECT RAISE(ABORT,'Tentativas finalizadas sÃ£o imutÃ¡veis.');
   END`,
  `CREATE TRIGGER IF NOT EXISTS notification_attempts_validate_completion
   BEFORE UPDATE ON notification_attempts
   WHEN OLD.status='processing' AND OLD.finished_at IS NULL AND NOT (
     NEW.id IS OLD.id AND
     NEW.notification_id IS OLD.notification_id AND
     NEW.attempt_number IS OLD.attempt_number AND
     NEW.origin IS OLD.origin AND
     NEW.lock_token IS OLD.lock_token AND
     NEW.started_at IS OLD.started_at AND
     NEW.status IN ('sent','failed','delivery_unknown') AND
     NEW.finished_at IS NOT NULL
   )
   BEGIN
     SELECT RAISE(ABORT,'Uma tentativa ativa sÃ³ pode ser concluÃ­da preservando sua identidade.');
   END`,
] as const;
