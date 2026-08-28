use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};
use tempfile::NamedTempFile;

const CONFIG_FILE_NAME: &str = "pack-favorites.json";

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackFavorites {
    #[serde(default)]
    favorite_ids: Vec<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioPacksCommandError {
    code: &'static str,
    message: String,
    technical_message: String,
}

impl ScenarioPacksCommandError {
    fn new(
        code: &'static str,
        message: impl Into<String>,
        technical_message: impl Into<String>,
    ) -> Self {
        Self {
            code,
            message: message.into(),
            technical_message: technical_message.into(),
        }
    }
}

fn config_path(app_handle: &AppHandle) -> Result<PathBuf, ScenarioPacksCommandError> {
    app_handle
        .path()
        .app_config_dir()
        .map(|directory| directory.join(CONFIG_FILE_NAME))
        .map_err(|error| {
            ScenarioPacksCommandError::new(
                "configuration-read-failed",
                "The pack favorites location is unavailable.",
                error.to_string(),
            )
        })
}

fn read_favorites(path: &Path) -> Result<PackFavorites, ScenarioPacksCommandError> {
    let content = match fs::read(path) {
        Ok(content) => content,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(PackFavorites::default()),
        Err(error) => {
            return Err(ScenarioPacksCommandError::new(
                "configuration-read-failed",
                "The pack favorites could not be read.",
                error.to_string(),
            ))
        }
    };

    serde_json::from_slice::<PackFavorites>(&content).map_err(|error| {
        ScenarioPacksCommandError::new(
            "configuration-read-failed",
            "The pack favorites file is invalid.",
            error.to_string(),
        )
    })
}

fn write_favorites(
    path: &Path,
    favorites: &PackFavorites,
) -> Result<(), ScenarioPacksCommandError> {
    let directory = path.parent().ok_or_else(|| {
        ScenarioPacksCommandError::new(
            "configuration-write-failed",
            "The pack favorites location is invalid.",
            path.display().to_string(),
        )
    })?;

    fs::create_dir_all(directory).map_err(|error| {
        ScenarioPacksCommandError::new(
            "configuration-write-failed",
            "The pack favorites directory could not be created.",
            error.to_string(),
        )
    })?;

    let mut temporary = NamedTempFile::new_in(directory).map_err(|error| {
        ScenarioPacksCommandError::new(
            "configuration-write-failed",
            "The pack favorites could not be saved.",
            error.to_string(),
        )
    })?;
    serde_json::to_writer_pretty(&mut temporary, favorites).map_err(|error| {
        ScenarioPacksCommandError::new(
            "configuration-write-failed",
            "The pack favorites could not be serialized.",
            error.to_string(),
        )
    })?;
    temporary.flush().map_err(|error| {
        ScenarioPacksCommandError::new(
            "configuration-write-failed",
            "The pack favorites could not be saved.",
            error.to_string(),
        )
    })?;
    temporary.persist(path).map_err(|error| {
        ScenarioPacksCommandError::new(
            "configuration-write-failed",
            "The pack favorites could not be saved.",
            error.error.to_string(),
        )
    })?;

    Ok(())
}

#[tauri::command]
pub async fn list_favorite_packs(
    app_handle: AppHandle,
) -> Result<Vec<String>, ScenarioPacksCommandError> {
    let path = config_path(&app_handle)?;
    let favorites = tauri::async_runtime::spawn_blocking(move || read_favorites(&path))
        .await
        .map_err(|error| {
            ScenarioPacksCommandError::new(
                "configuration-read-failed",
                "The pack favorites could not be read.",
                error.to_string(),
            )
        })??;
    Ok(favorites.favorite_ids)
}

#[tauri::command]
pub async fn set_pack_favorite(
    app_handle: AppHandle,
    pack_id: String,
    favorite: bool,
) -> Result<Vec<String>, ScenarioPacksCommandError> {
    let path = config_path(&app_handle)?;
    let read_path = path.clone();
    let mut favorites = tauri::async_runtime::spawn_blocking(move || read_favorites(&read_path))
        .await
        .map_err(|error| {
            ScenarioPacksCommandError::new(
                "configuration-read-failed",
                "The pack favorites could not be read.",
                error.to_string(),
            )
        })??;

    if favorite {
        if !favorites.favorite_ids.iter().any(|id| id == &pack_id) {
            favorites.favorite_ids.push(pack_id);
        }
    } else {
        favorites.favorite_ids.retain(|id| id != &pack_id);
    }

    let saved_favorites = favorites.clone();
    tauri::async_runtime::spawn_blocking(move || write_favorites(&path, &saved_favorites))
        .await
        .map_err(|error| {
            ScenarioPacksCommandError::new(
                "configuration-write-failed",
                "The pack favorites could not be saved.",
                error.to_string(),
            )
        })??;

    Ok(favorites.favorite_ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn defaults_to_empty_when_file_is_missing() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join(CONFIG_FILE_NAME);

        let favorites = read_favorites(&path).unwrap();

        assert_eq!(favorites, PackFavorites::default());
    }

    #[test]
    fn round_trips_written_favorites() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join(CONFIG_FILE_NAME);
        let favorites = PackFavorites {
            favorite_ids: vec!["restaurant".to_string(), "shopping".to_string()],
        };

        write_favorites(&path, &favorites).unwrap();
        let read_back = read_favorites(&path).unwrap();

        assert_eq!(read_back, favorites);
    }

    #[test]
    fn rejects_invalid_json() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join(CONFIG_FILE_NAME);
        fs::write(&path, b"not json").unwrap();

        let result = read_favorites(&path);

        assert!(result.is_err());
    }
}
