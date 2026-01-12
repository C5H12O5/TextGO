use crate::error::AppError;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const DB_FILENAME: &str = "ai-cache.sqlite3";

fn now_unix_seconds() -> Result<i64, AppError> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| AppError::from("System time is before UNIX_EPOCH"))?
        .as_secs() as i64)
}

fn cache_db_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join(DB_FILENAME))
}

fn open_db(app: &AppHandle) -> Result<Connection, AppError> {
    let path = cache_db_path(app)?;
    let conn = Connection::open(path)?;

    // best-effort pragmas
    let _ = conn.pragma_update(None, "journal_mode", &"WAL");
    let _ = conn.pragma_update(None, "synchronous", &"NORMAL");

    // Create current schema (prompt-only key).
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS ai_cache (
          prompt TEXT NOT NULL PRIMARY KEY,
          response TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ai_cache_updated_at ON ai_cache(updated_at);
        "#,
    )?;

    // Migrate legacy schema (template_id + prompt composite key) into the current schema.
    let has_template_id = {
        let mut stmt = conn.prepare("PRAGMA table_info(ai_cache)")?;
        let columns: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?;
        columns.iter().any(|c| c == "template_id")
    };
    if has_template_id {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS ai_cache_v2 (
              prompt TEXT NOT NULL PRIMARY KEY,
              response TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );
            INSERT OR REPLACE INTO ai_cache_v2 (prompt, response, created_at, updated_at)
              SELECT prompt, response, created_at, updated_at FROM ai_cache;
            DROP TABLE ai_cache;
            ALTER TABLE ai_cache_v2 RENAME TO ai_cache;
            CREATE INDEX IF NOT EXISTS ai_cache_updated_at ON ai_cache(updated_at);
            "#,
        )?;
    }

    Ok(conn)
}

/// Get cached AI response.
///
/// Cache key: prompt exact match.
#[tauri::command]
pub fn ai_cache_get(app: AppHandle, prompt: String) -> Result<Option<String>, AppError> {
    let conn = open_db(&app)?;
    let mut stmt = conn.prepare("SELECT response FROM ai_cache WHERE prompt = ?1")?;
    let cached = stmt
        .query_row(params![prompt], |row| row.get::<_, String>(0))
        .optional()?;
    Ok(cached)
}

/// Save cached AI response.
///
/// Cache key: prompt exact match.
#[tauri::command]
pub fn ai_cache_set(app: AppHandle, prompt: String, response: String) -> Result<(), AppError> {
    let conn = open_db(&app)?;
    let now = now_unix_seconds()?;

    conn.execute(
        r#"
        INSERT INTO ai_cache (prompt, response, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?3)
        ON CONFLICT(prompt)
        DO UPDATE SET response = excluded.response, updated_at = excluded.updated_at;
        "#,
        params![prompt, response, now],
    )?;

    Ok(())
}
