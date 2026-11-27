-- When Instagram refused a comment's DM as too many new conversations, the public reply tells them to DM the keyword
-- instead (src/comments.ts tellRefused). fallback_at = when that reply went out; 0 = nothing to offer them.
ALTER TABLE comments ADD COLUMN fallback_at INTEGER;
