-- seed_demo_data.sql
--
-- Run this after create_tables.sql if you want demo data.

INSERT INTO users
(name, email, role, location, subjects, available_times, languages, grade_level, teaching_style)
VALUES
('Bob Student', 'bob@example.com', 'student', 'San Jose',
 ARRAY['math'], ARRAY['Wed 7pm', 'Sat 2pm'], ARRAY['English', 'Korean'], 'middle_school', 'step_by_step'),

('Alice Mentor', 'alice@example.com', 'mentor', 'San Jose',
 ARRAY['math', 'python'], ARRAY['Mon 6pm', 'Wed 7pm'], ARRAY['English', 'Korean'], 'college', 'step_by_step'),

('Chris Mentor', 'chris@example.com', 'mentor', 'Mountain View',
 ARRAY['math', 'physics'], ARRAY['Sat 2pm'], ARRAY['English'], 'college', 'visual'),

('Dana Mentor', 'dana@example.com', 'mentor', 'San Jose',
 ARRAY['english', 'history'], ARRAY['Wed 7pm'], ARRAY['English'], 'college', 'discussion'),

('Eli Mentor', 'eli@example.com', 'mentor', 'San Jose',
 ARRAY['math'], ARRAY['Fri 5pm'], ARRAY['Korean'], 'high_school', 'step_by_step');

INSERT INTO questions
(student_id, subject, topic, preferred_time, preferred_language, preferred_teaching_style, message)
VALUES
(1, 'math', 'algebra', 'Wed 7pm', 'Korean', 'step_by_step',
 'I need help with algebra and want very clear step-by-step explanations.');

-- Example block:
-- Bob blocks Chris, so Chris should not appear in Bob's matching results.
INSERT INTO blocked_users (blocker_id, blocked_id)
VALUES (1, 3);

-- Example report:
INSERT INTO reports (reporter_id, reported_id, reason, details)
VALUES (1, 3, 'No show', 'Mentor did not attend the scheduled session.');
