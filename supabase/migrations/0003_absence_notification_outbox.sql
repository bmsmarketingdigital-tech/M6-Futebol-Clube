alter table notification_outbox
  drop constraint if exists notification_outbox_event_type_check;

alter table notification_outbox
  add constraint notification_outbox_event_type_check
  check (event_type in ('before_due','due_today','overdue','enrollment','controlled_test','absence'));

alter table notification_outbox
  drop constraint if exists notification_outbox_last_attempt_origin_check;

alter table notification_outbox
  add constraint notification_outbox_last_attempt_origin_check
  check (last_attempt_origin is null or last_attempt_origin in ('startup','reconnect','automatic','verify_now','enrollment','controlled_test','attendance','manual'));
