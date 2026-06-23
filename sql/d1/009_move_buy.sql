-- Adds buy_options to move_tasks: a JSON array (max 4) of {label,url,price?} purchase
-- options. NULL/empty = the task is not a buy-item. Rendered as a colored title that
-- opens a popup with up to four retailer links. Filled by research / manual edit only —
-- the AI agent never writes this column (no invented shopping URLs).
ALTER TABLE move_tasks ADD COLUMN buy_options TEXT;
