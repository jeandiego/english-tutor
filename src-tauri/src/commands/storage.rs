use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;
use tauri::AppHandle;

use super::history::{self, HistoryCommandError};

const SQLITE_HEADER: &[u8] = b"SQLite format 3\0";

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StorageCommandError {
    code: &'static str,
    message: String,
    technical_message: String,
}

impl StorageCommandError {
    fn new(code: &'static str, message: impl Into<String>, technical_message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            technical_message: technical_message.into(),
        }
    }
}

impl From<HistoryCommandError> for StorageCommandError {
    fn from(error: HistoryCommandError) -> Self {
        let (code, message, technical_message) = error.into_parts();
        Self {
            code,
            message,
            technical_message,
        }
    }
}

impl From<rusqlite::Error> for StorageCommandError {
    fn from(error: rusqlite::Error) -> Self {
        Self::new(
            "storage-database-error",
            "The learning history database could not be read.",
            error.to_string(),
        )
    }
}

impl From<std::io::Error> for StorageCommandError {
    fn from(error: std::io::Error) -> Self {
        Self::new(
            "storage-io-error",
            "The learning history file could not be accessed.",
            error.to_string(),
        )
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    size_bytes: u64,
    path: String,
}

fn sidecar_paths(path: &Path) -> [PathBuf; 2] {
    let wal = path.with_extension(match path.extension() {
        Some(extension) => format!("{}-wal", extension.to_string_lossy()),
        None => "-wal".to_string(),
    });
    let shm = path.with_extension(match path.extension() {
        Some(extension) => format!("{}-shm", extension.to_string_lossy()),
        None => "-shm".to_string(),
    });
    [wal, shm]
}

fn remove_if_exists(path: &Path) -> std::io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub async fn get_storage_info(app_handle: AppHandle) -> Result<StorageInfo, StorageCommandError> {
    let path = history::db_path(&app_handle)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<StorageInfo, StorageCommandError> {
        let size_bytes = fs::metadata(&path).map(|metadata| metadata.len()).unwrap_or(0);
        Ok(StorageInfo {
            size_bytes,
            path: path.display().to_string(),
        })
    })
    .await
    .map_err(|error| {
        StorageCommandError::new(
            "storage-task-failed",
            "The storage information could not be read.",
            error.to_string(),
        )
    })?
}

#[tauri::command]
pub async fn wipe_database(app_handle: AppHandle) -> Result<(), StorageCommandError> {
    let path = history::db_path(&app_handle)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<(), StorageCommandError> {
        remove_if_exists(&path)?;
        for sidecar in sidecar_paths(&path) {
            remove_if_exists(&sidecar)?;
        }
        // Recreate immediately so the app has a valid, migrated database
        // ready for the very next read rather than lazily on next launch.
        history::open_connection(&path)?;
        Ok(())
    })
    .await
    .map_err(|error| {
        StorageCommandError::new(
            "storage-task-failed",
            "The learning history could not be wiped.",
            error.to_string(),
        )
    })?
}

#[tauri::command]
pub async fn export_database(
    app_handle: AppHandle,
    destination: String,
) -> Result<(), StorageCommandError> {
    let source = history::db_path(&app_handle)?;
    let destination = PathBuf::from(destination);
    tauri::async_runtime::spawn_blocking(move || -> Result<(), StorageCommandError> {
        let conn = history::open_connection(&source)?;
        // Flush the WAL into the main file so a plain file copy captures
        // everything that's been committed.
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
        drop(conn);
        fs::copy(&source, &destination)?;
        Ok(())
    })
    .await
    .map_err(|error| {
        StorageCommandError::new(
            "storage-task-failed",
            "The learning history could not be exported.",
            error.to_string(),
        )
    })?
}

fn looks_like_sqlite_file(path: &Path) -> std::io::Result<bool> {
    let bytes = fs::read(path)?;
    Ok(bytes.len() >= SQLITE_HEADER.len() && &bytes[..SQLITE_HEADER.len()] == SQLITE_HEADER)
}

#[tauri::command]
pub async fn import_database(
    app_handle: AppHandle,
    source: String,
) -> Result<(), StorageCommandError> {
    let destination = history::db_path(&app_handle)?;
    let source = PathBuf::from(source);
    tauri::async_runtime::spawn_blocking(move || -> Result<(), StorageCommandError> {
        if !looks_like_sqlite_file(&source)? {
            return Err(StorageCommandError::new(
                "storage-invalid-file",
                "That file isn't a valid SQLite database.",
                "The selected file's header did not match the SQLite format.",
            ));
        }

        // Sanity-check the file actually opens and its pages aren't corrupt
        // before it replaces the real database.
        let check_conn = Connection::open(&source)?;
        let integrity: String =
            check_conn.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
        if integrity != "ok" {
            return Err(StorageCommandError::new(
                "storage-invalid-file",
                "That file isn't a valid SQLite database.",
                format!("quick_check reported: {integrity}"),
            ));
        }
        drop(check_conn);

        remove_if_exists(&destination)?;
        for sidecar in sidecar_paths(&destination) {
            remove_if_exists(&sidecar)?;
        }
        fs::copy(&source, &destination)?;

        // Bring the imported database up to the current schema version.
        history::open_connection(&destination)?;
        Ok(())
    })
    .await
    .map_err(|error| {
        StorageCommandError::new(
            "storage-task-failed",
            "The learning history could not be imported.",
            error.to_string(),
        )
    })?
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn sidecar_paths_append_wal_and_shm_suffixes() {
        let db_path = PathBuf::from("/data/history.sqlite3");
        let [wal, shm] = sidecar_paths(&db_path);
        assert_eq!(wal, PathBuf::from("/data/history.sqlite3-wal"));
        assert_eq!(shm, PathBuf::from("/data/history.sqlite3-shm"));
    }

    #[test]
    fn remove_if_exists_is_a_no_op_for_a_missing_file() {
        let directory = TempDir::new().expect("tempdir must exist");
        let missing = directory.path().join("missing.sqlite3");
        remove_if_exists(&missing).expect("removing a missing file must not error");
    }

    #[test]
    fn looks_like_sqlite_file_accepts_a_real_database_and_rejects_plain_text() {
        let directory = TempDir::new().expect("tempdir must exist");

        let db_path = directory.path().join("real.sqlite3");
        let conn = Connection::open(&db_path).expect("connection must open");
        conn.execute_batch("CREATE TABLE t (id INTEGER PRIMARY KEY);")
            .expect("table must create");
        drop(conn);
        assert!(looks_like_sqlite_file(&db_path).expect("read must succeed"));

        let text_path = directory.path().join("not-a-database.txt");
        fs::write(&text_path, b"just some text").expect("write must succeed");
        assert!(!looks_like_sqlite_file(&text_path).expect("read must succeed"));
    }
}
