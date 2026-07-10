const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');

const DATA_ROOT_DIR = process.env.SCRIPTFORGE_DATA_DIR || path.join(__dirname, '..');
const PROFILE_ROOT_DIR = path.join(DATA_ROOT_DIR, 'browser-profiles');
const PROFILE_CONFIG_PATH = path.join(PROFILE_ROOT_DIR, 'profiles.json');
const DEFAULT_PROFILE_ID = 'default';
const DEFAULT_PROFILE_DIR = path.join(DATA_ROOT_DIR, 'browser-data');

function nowIso() {
  return new Date().toISOString();
}

function sanitizeLabel(label) {
  const normalized = String(label || '').replace(/\s+/g, ' ').trim();
  return normalized.slice(0, 80) || 'Claude Account';
}

function createDefaultState() {
  return {
    activeProfileId: DEFAULT_PROFILE_ID,
    profiles: [
      {
        id: DEFAULT_PROFILE_ID,
        label: 'Default Claude',
        userDataDir: DEFAULT_PROFILE_DIR,
        createdAt: nowIso(),
        lastUsedAt: null,
        isDefault: true,
      },
    ],
  };
}

function normalizeProfile(profile) {
  return {
    id: profile.id,
    label: sanitizeLabel(profile.label),
    userDataDir: profile.userDataDir,
    createdAt: profile.createdAt || nowIso(),
    lastUsedAt: profile.lastUsedAt || null,
    isDefault: Boolean(profile.isDefault),
  };
}

async function ensureProfileRoot() {
  await fs.mkdir(PROFILE_ROOT_DIR, { recursive: true });
}

async function readProfilesState() {
  await ensureProfileRoot();

  try {
    const raw = await fs.readFile(PROFILE_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const profiles = Array.isArray(parsed.profiles)
      ? parsed.profiles.map(normalizeProfile)
      : [];

    if (!profiles.some((profile) => profile.id === DEFAULT_PROFILE_ID)) {
      profiles.unshift(createDefaultState().profiles[0]);
    }

    return {
      activeProfileId:
        profiles.some((profile) => profile.id === parsed.activeProfileId)
          ? parsed.activeProfileId
          : DEFAULT_PROFILE_ID,
      profiles,
    };
  } catch {
    const state = createDefaultState();
    await writeProfilesState(state);
    return state;
  }
}

async function writeProfilesState(state) {
  await ensureProfileRoot();
  await fs.writeFile(PROFILE_CONFIG_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function toPublicProfile(profile, activeProfileId) {
  return {
    id: profile.id,
    label: profile.label,
    createdAt: profile.createdAt,
    lastUsedAt: profile.lastUsedAt,
    isActive: profile.id === activeProfileId,
    isDefault: profile.isDefault,
  };
}

function toPublicProfilesState(state) {
  return {
    activeProfileId: state.activeProfileId,
    profiles: state.profiles.map((profile) =>
      toPublicProfile(profile, state.activeProfileId)
    ),
  };
}

async function getProfilesState() {
  return readProfilesState();
}

async function getActiveProfile() {
  const state = await readProfilesState();
  const profile =
    state.profiles.find((candidate) => candidate.id === state.activeProfileId) ||
    state.profiles[0];

  return {
    state,
    profile,
  };
}

async function createProfile(label) {
  const state = await readProfilesState();
  const id = `profile_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const createdAt = nowIso();
  const profile = {
    id,
    label: sanitizeLabel(label || `Claude Account ${state.profiles.length + 1}`),
    userDataDir: path.join(PROFILE_ROOT_DIR, id),
    createdAt,
    lastUsedAt: null,
    isDefault: false,
  };

  state.profiles.push(profile);
  state.activeProfileId = id;
  await writeProfilesState(state);

  return {
    state,
    profile,
  };
}

async function switchProfile(profileId) {
  const state = await readProfilesState();
  const profile = state.profiles.find((candidate) => candidate.id === profileId);

  if (!profile) {
    throw new Error('Claude profile not found.');
  }

  state.activeProfileId = profile.id;
  profile.lastUsedAt = nowIso();
  await writeProfilesState(state);

  return {
    state,
    profile,
  };
}

async function renameProfile(profileId, label) {
  const state = await readProfilesState();
  const profile = state.profiles.find((candidate) => candidate.id === profileId);

  if (!profile) {
    throw new Error('Claude profile not found.');
  }

  profile.label = sanitizeLabel(label);
  await writeProfilesState(state);

  return {
    state,
    profile,
  };
}

async function deleteProfile(profileId) {
  const state = await readProfilesState();
  const profile = state.profiles.find((candidate) => candidate.id === profileId);

  if (!profile) {
    throw new Error('Claude profile not found.');
  }

  if (profile.isDefault || profile.id === DEFAULT_PROFILE_ID) {
    throw new Error('Default Claude profile cannot be deleted.');
  }

  if (profile.id === state.activeProfileId) {
    throw new Error('Switch to another Claude profile before deleting this one.');
  }

  state.profiles = state.profiles.filter((candidate) => candidate.id !== profile.id);
  await writeProfilesState(state);
  await fs.rm(profile.userDataDir, { recursive: true, force: true }).catch(() => {});

  return state;
}

module.exports = {
  createProfile,
  deleteProfile,
  getActiveProfile,
  getProfilesState,
  renameProfile,
  switchProfile,
  toPublicProfilesState,
};
