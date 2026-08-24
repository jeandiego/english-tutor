use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHealth {
    app_status: &'static str,
    operating_system: &'static str,
    architecture: &'static str,
}

#[tauri::command]
pub fn health_check() -> RuntimeHealth {
    RuntimeHealth {
        app_status: "ready",
        operating_system: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_compile_target_runtime_information() {
        let health = health_check();

        assert_eq!(health.app_status, "ready");
        assert_eq!(health.operating_system, std::env::consts::OS);
        assert_eq!(health.architecture, std::env::consts::ARCH);
    }

    #[test]
    fn serializes_with_the_frontend_contract() {
        let value = serde_json::to_value(health_check()).expect("health must serialize");

        assert_eq!(value["appStatus"], "ready");
        assert_eq!(value["operatingSystem"], std::env::consts::OS);
        assert_eq!(value["architecture"], std::env::consts::ARCH);
    }
}
