package db

const schema = `
CREATE TABLE IF NOT EXISTS recipes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT    NOT NULL,
    description   TEXT    NOT NULL DEFAULT '',
    image_url     TEXT    NOT NULL DEFAULT '',
    prep_time     INTEGER NOT NULL DEFAULT 0,
    cook_time     INTEGER NOT NULL DEFAULT 0,
    base_servings INTEGER NOT NULL DEFAULT 4,
    source_url    TEXT    NOT NULL DEFAULT '',
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ingredients (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id  INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    name       TEXT    NOT NULL,
    amount     REAL    NOT NULL DEFAULT 0,
    unit       TEXT    NOT NULL DEFAULT '',
    notes      TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS steps (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id   INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    instruction TEXT    NOT NULL,
    duration    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pantry_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,
    category   TEXT    NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`
