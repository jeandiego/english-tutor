use serde::{Deserialize, Serialize};

/// Coarse accent-region tagging for a voice, derived from whatever metadata
/// a provider already exposes (locale token or ElevenLabs' own accent
/// label) — never a promise of complete or precise accent coverage, per the
/// doc's non-goals. Voices that don't map to one of these stay untagged
/// (`None`) and simply fall outside accent-focus filtering.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AccentRegion {
    American,
    British,
    Irish,
    Australian,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VoiceGender {
    Female,
    Male,
}

/// Maps a locale token (`en-US`, `en_GB`, ...) to an accent region.
pub(super) fn accent_region_from_locale(locale: &str) -> Option<AccentRegion> {
    let normalized = locale.to_ascii_lowercase().replace('_', "-");
    let region = normalized.split('-').nth(1)?;
    match region {
        "us" => Some(AccentRegion::American),
        "gb" | "uk" => Some(AccentRegion::British),
        "ie" => Some(AccentRegion::Irish),
        "au" => Some(AccentRegion::Australian),
        _ => None,
    }
}

/// Maps ElevenLabs' own `labels.accent` string to an accent region.
pub(super) fn accent_region_from_label(label: &str) -> Option<AccentRegion> {
    match label.trim().to_ascii_lowercase().as_str() {
        "american" | "us" => Some(AccentRegion::American),
        "british" | "english" | "uk" => Some(AccentRegion::British),
        "irish" => Some(AccentRegion::Irish),
        "australian" | "aussie" => Some(AccentRegion::Australian),
        _ => None,
    }
}

const FEMALE_MACOS_VOICE_NAMES: &[&str] = &[
    "Samantha", "Victoria", "Karen", "Moira", "Tessa", "Serena", "Kate", "Allison", "Ava",
    "Susan", "Vicki", "Fiona", "Zoe", "Nicky",
];
const MALE_MACOS_VOICE_NAMES: &[&str] = &[
    "Alex", "Fred", "Daniel", "Oliver", "Aaron", "Arthur", "Gordon", "Lee", "Ralph", "Tom",
    "Rishi",
];

/// Small hand-authored name table — macOS's `say -v ?` output doesn't
/// expose gender, so this is a best-effort lookup for well-known English
/// voice names, defaulting to `None` (unknown) rather than guessing.
pub(super) fn macos_gender(name: &str) -> Option<VoiceGender> {
    let trimmed = name.trim();
    if FEMALE_MACOS_VOICE_NAMES
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(trimmed))
    {
        Some(VoiceGender::Female)
    } else if MALE_MACOS_VOICE_NAMES
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(trimmed))
    {
        Some(VoiceGender::Male)
    } else {
        None
    }
}

/// Kokoro voice ids already encode accent and gender in their prefix
/// (`af_`/`am_` = American female/male, `bf_`/`bm_` = British female/male).
pub(super) fn kokoro_prefix_metadata(id: &str) -> (Option<AccentRegion>, Option<VoiceGender>) {
    let mut chars = id.chars();
    let accent = match chars.next() {
        Some('a') => Some(AccentRegion::American),
        Some('b') => Some(AccentRegion::British),
        _ => None,
    };
    let gender = match chars.next() {
        Some('f') => Some(VoiceGender::Female),
        Some('m') => Some(VoiceGender::Male),
        _ => None,
    };
    (accent, gender)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accent_region_from_locale_matches_known_regions() {
        assert_eq!(accent_region_from_locale("en-US"), Some(AccentRegion::American));
        assert_eq!(accent_region_from_locale("en_GB"), Some(AccentRegion::British));
        assert_eq!(accent_region_from_locale("en-IE"), Some(AccentRegion::Irish));
        assert_eq!(accent_region_from_locale("en-AU"), Some(AccentRegion::Australian));
        assert_eq!(accent_region_from_locale("fr-FR"), None);
        assert_eq!(accent_region_from_locale("en"), None);
    }

    #[test]
    fn accent_region_from_label_matches_elevenlabs_labels() {
        assert_eq!(accent_region_from_label("American"), Some(AccentRegion::American));
        assert_eq!(accent_region_from_label("british"), Some(AccentRegion::British));
        assert_eq!(accent_region_from_label("something else"), None);
    }

    #[test]
    fn macos_gender_matches_known_names_case_insensitively() {
        assert_eq!(macos_gender("samantha"), Some(VoiceGender::Female));
        assert_eq!(macos_gender("Alex"), Some(VoiceGender::Male));
        assert_eq!(macos_gender("Unknown Voice"), None);
    }

    #[test]
    fn kokoro_prefix_metadata_parses_accent_and_gender() {
        assert_eq!(
            kokoro_prefix_metadata("af_alice"),
            (Some(AccentRegion::American), Some(VoiceGender::Female))
        );
        assert_eq!(
            kokoro_prefix_metadata("bm_george"),
            (Some(AccentRegion::British), Some(VoiceGender::Male))
        );
    }
}
