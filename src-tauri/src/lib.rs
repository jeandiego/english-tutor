mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::health::health_check,
            commands::speech::speak_tutor_reply,
            commands::transcription::load_transcription_setup,
            commands::transcription::save_transcription_settings,
            commands::transcription::transcribe_audio,
            commands::tutor::load_tutor_setup,
            commands::tutor::save_tutor_settings,
            commands::tutor::generate_tutor_turn,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
