mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::assessment::generate_follow_up,
            commands::assessment::evaluate_response,
            commands::assessment::synthesize_assessment_summary,
            commands::assessment::start_assessment,
            commands::assessment::start_assessment_task_run,
            commands::assessment::record_assessment_turn_cycle,
            commands::assessment::complete_assessment_task_run,
            commands::assessment::complete_assessment,
            commands::assessment::get_latest_assessment,
            commands::assessment::list_assessments,
            commands::assessment::get_assessment_detail,
            commands::health::health_check,
            commands::history::start_session,
            commands::history::list_recent_sessions,
            commands::history::list_correction_category_counts,
            commands::history::list_recent_expressions,
            commands::learner_profile::get_learner_profile,
            commands::learner_profile::save_learner_profile_preferences,
            commands::learner_profile::apply_assessment_to_learner_profile,
            commands::transcription::load_transcription_setup,
            commands::transcription::save_transcription_settings,
            commands::transcription::transcribe_audio,
            commands::tts::load_tts_setup,
            commands::tts::save_tts_settings,
            commands::tts::speak_tutor_reply,
            commands::tutor::load_tutor_setup,
            commands::tutor::save_tutor_settings,
            commands::tutor::generate_tutor_turn,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
