import {
  CHARACTER_PROFILE_SCHEMA_VERSION,
  cloneCharacterProfile,
  DEFAULT_CHARACTER_PROFILE,
  sanitizeCharacterProfile,
  type CharacterProfile,
} from './CharacterProfile';

export const CHARACTER_PROFILE_STORAGE_KEY = `last-firmament.character.v${CHARACTER_PROFILE_SCHEMA_VERSION}`;
export const LEGACY_CHARACTER_PROFILE_STORAGE_KEY = 'last-firmament.character.v1';

export type CharacterProfileSaveResult = Readonly<{
  profile: CharacterProfile;
  persisted: boolean;
  failure: 'storage-unavailable' | 'write-failed' | null;
}>;

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadCharacterProfile(storage: Storage | null = browserStorage()): CharacterProfile {
  if (!storage) return cloneCharacterProfile(DEFAULT_CHARACTER_PROFILE);
  try {
    const raw = storage.getItem(CHARACTER_PROFILE_STORAGE_KEY) ?? storage.getItem(LEGACY_CHARACTER_PROFILE_STORAGE_KEY);
    if (!raw) return cloneCharacterProfile(DEFAULT_CHARACTER_PROFILE);
    const profile = sanitizeCharacterProfile(JSON.parse(raw) as unknown);
    if (!storage.getItem(CHARACTER_PROFILE_STORAGE_KEY)) {
      try {
        storage.setItem(CHARACTER_PROFILE_STORAGE_KEY, JSON.stringify(profile));
      } catch {
        // A readable legacy profile remains valid for this session even if the
        // browser refuses the best-effort v2 migration write.
      }
    }
    return profile;
  } catch {
    return cloneCharacterProfile(DEFAULT_CHARACTER_PROFILE);
  }
}

export function saveCharacterProfile(
  profile: CharacterProfile,
  storage: Storage | null = browserStorage(),
): CharacterProfileSaveResult {
  const safeProfile = sanitizeCharacterProfile(profile);
  if (!storage) {
    return { profile: safeProfile, persisted: false, failure: 'storage-unavailable' };
  }
  try {
    const serialized = JSON.stringify(safeProfile);
    storage.setItem(CHARACTER_PROFILE_STORAGE_KEY, serialized);
    if (storage.getItem(CHARACTER_PROFILE_STORAGE_KEY) !== serialized) {
      return { profile: safeProfile, persisted: false, failure: 'write-failed' };
    }
  } catch {
    return { profile: safeProfile, persisted: false, failure: 'write-failed' };
  }
  return { profile: safeProfile, persisted: true, failure: null };
}
