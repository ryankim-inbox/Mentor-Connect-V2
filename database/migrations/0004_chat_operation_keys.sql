
-- Optional operation keys preserve legacy messages and make REST retries safe.
ALTER TABLE chat_messages ADD COLUMN client_message_id uuid;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_operation_key
    UNIQUE (sender_id, room_id, client_message_id);
ALTER TABLE dm_messages ADD COLUMN client_message_id uuid;
ALTER TABLE dm_messages ADD CONSTRAINT dm_messages_operation_key
    UNIQUE (sender_id, conversation_id, client_message_id);
