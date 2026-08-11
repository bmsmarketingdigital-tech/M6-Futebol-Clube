CREATE UNIQUE INDEX `athlete_check_ins_logical_unique`
ON `athlete_check_ins` (`organization_id`, `athlete_id`, `team_id`, `attendance_session_id`);
