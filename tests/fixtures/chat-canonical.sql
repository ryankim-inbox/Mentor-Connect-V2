-- Data only: load after database/schema/canonical.sql in a disposable database.
INSERT INTO districts (id, name, county, type) VALUES
  (1, 'Fremont Union High School District', 'Santa Clara', 'high_school'),
  (2, 'East Side Union High School District', 'Santa Clara', 'high_school');

INSERT INTO tags (id, name, color) VALUES (1, 'Math', '#3b82f6');

-- All five test accounts use Password123!, matching the teaching fixture.
INSERT INTO users (id, email, name, password_hash, role, district_id) VALUES
  (1, 'student001@test.edu', 'Alex Kim', '$2b$10$DIg3.KsIwivHGnITlbg4CetUZ3GR3tyENpNDzjsKF76JM.GAwyJNu', 'mentee', 1),
  (2, 'aiko.yoon.0002@test.edu', 'Aiko Yoon', '$2b$10$DIg3.KsIwivHGnITlbg4CetUZ3GR3tyENpNDzjsKF76JM.GAwyJNu', 'mentee', 2),
  (501, 'mentor501@test.edu', 'Sophia Lee', '$2b$10$DIg3.KsIwivHGnITlbg4CetUZ3GR3tyENpNDzjsKF76JM.GAwyJNu', 'mentor', 1),
  (502, 'santiago.khan.0502@test.edu', 'Marcus Chen', '$2b$10$DIg3.KsIwivHGnITlbg4CetUZ3GR3tyENpNDzjsKF76JM.GAwyJNu', 'mentor', 1),
  (951, 'both951@test.edu', 'Jordan Park', '$2b$10$DIg3.KsIwivHGnITlbg4CetUZ3GR3tyENpNDzjsKF76JM.GAwyJNu', 'both', 2);

INSERT INTO blocks (id, blocker_id, blocked_user_id) VALUES (1, 1, 502);

INSERT INTO chat_rooms (id, type, district_id, name) VALUES
  (1, 'global', NULL, 'Global Chat'),
  (2, 'district', 1, 'Fremont Union High School District Chat'),
  (3, 'district', 2, 'East Side Union High School District Chat');

INSERT INTO chat_messages (id, room_id, sender_id, body, created_at) VALUES
  (1, 1, 1, 'Hi everyone! First message in the global room.', '2026-07-01 16:00:00+00'),
  (2, 1, 501, 'Welcome! Once the chat API works you should see this in the Global tab.', '2026-07-01 16:02:00+00'),
  (3, 1, 951, 'Hello from East Side Union — this room is for every district.', '2026-07-01 16:05:00+00'),
  (4, 1, 1, 'If you can read this in the app, Mission 2 of the chat guide works!', '2026-07-01 16:07:00+00'),
  (5, 2, 1, 'Anyone up for an algebra study group this week?', '2026-07-01 17:00:00+00'),
  (6, 2, 501, 'I mentor Monday 17:00 — bring your quadratics questions.', '2026-07-01 17:03:00+00'),
  (7, 2, 1, 'Perfect, see you Monday!', '2026-07-01 17:04:00+00'),
  (8, 3, 951, 'First message in the East Side Union room. Say hi when you land here!', '2026-07-01 18:00:00+00');

INSERT INTO chat_messages (id, room_id, sender_id, body, created_at, deleted_at) VALUES
  (9, 1, 951, 'Deleted global message', '2026-07-01 16:08:00+00', '2026-07-01 16:09:00+00');

INSERT INTO dm_conversations (id, user_a_id, user_b_id, created_at) VALUES
  (1, 1, 501, '2026-07-01 19:00:00+00'),
  (2, 1, 951, '2026-07-01 19:30:00+00');

INSERT INTO dm_messages (id, conversation_id, sender_id, body, created_at, read_at) VALUES
  (1, 1, 1, 'Hi Sophia! Could we go over quadratic equations before Monday?', '2026-07-01 19:00:30+00', '2026-07-01 19:01:00+00'),
  (2, 1, 501, 'Of course — bring the two problems that stumped you.', '2026-07-01 19:02:00+00', '2026-07-01 19:02:30+00'),
  (3, 1, 1, 'Will do. Thanks!', '2026-07-01 19:03:00+00', NULL),
  (4, 2, 951, 'Hey Alex, saw your study-habits request — happy to share what worked for me.', '2026-07-01 19:31:00+00', '2026-07-01 19:32:00+00'),
  (5, 2, 1, 'That would be great. Thursday evening okay?', '2026-07-01 19:33:00+00', NULL),
  (6, 2, 951, 'Thursday 18:00 works — it is already in my availability.', '2026-07-01 19:34:00+00', NULL);

INSERT INTO dm_messages (id, conversation_id, sender_id, body, created_at, deleted_at) VALUES
  (7, 1, 501, 'Deleted DM message', '2026-07-01 19:05:00+00', '2026-07-01 19:06:00+00');

SELECT setval(pg_get_serial_sequence('districts', 'id'), (SELECT max(id) FROM districts));
SELECT setval(pg_get_serial_sequence('tags', 'id'), (SELECT max(id) FROM tags));
SELECT setval(pg_get_serial_sequence('users', 'id'), (SELECT max(id) FROM users));
SELECT setval(pg_get_serial_sequence('blocks', 'id'), (SELECT max(id) FROM blocks));
SELECT setval(pg_get_serial_sequence('chat_rooms', 'id'), (SELECT max(id) FROM chat_rooms));
SELECT setval(pg_get_serial_sequence('chat_messages', 'id'), (SELECT max(id) FROM chat_messages));
SELECT setval(pg_get_serial_sequence('dm_conversations', 'id'), (SELECT max(id) FROM dm_conversations));
SELECT setval(pg_get_serial_sequence('dm_messages', 'id'), (SELECT max(id) FROM dm_messages));
