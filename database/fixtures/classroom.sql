INSERT INTO districts (name, county, type) VALUES
  ('Classroom North', 'Practice County', 'high_school'),
  ('Classroom South', 'Practice County', 'high_school');

INSERT INTO tags (name, color) VALUES
  ('Math', '#6366f1'),
  ('Science', '#10b981');

INSERT INTO chat_rooms (type, district_id, name)
VALUES ('global', NULL, 'Classroom Lounge');

INSERT INTO chat_rooms (type, district_id, name)
SELECT 'district', id, name || ' Chat' FROM districts;
