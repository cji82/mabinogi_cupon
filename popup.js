const PROFILES_KEY = 'profiles';
const ACTIVE_PROFILE_KEY = 'activeProfileId';
const AUTO_SELECT_KEY = 'autoSelectChar';
const LEGACY_NPA_KEY = 'npaCode';
const LAST_RESULT_KEY = 'lastApplyResult';
const NEW_PROFILE_VALUE = '__new__';

const profileSelect = document.getElementById('profileSelect');
const nicknameInput = document.getElementById('nickname');
const npaInput = document.getElementById('npaCode');
const couponInput = document.getElementById('coupon');
const autoSelectInput = document.getElementById('autoSelectChar');
const deleteBtn = document.getElementById('deleteProfile');
const saveBtn = document.getElementById('saveProfile');
const moveUpBtn = document.getElementById('moveUp');
const moveDownBtn = document.getElementById('moveDown');
const setDefaultBtn = document.getElementById('setDefault');
const statusEl = document.getElementById('status');

let profiles = [];
let activeProfileId = '';

function setStatus(message, type = '') {
  statusEl.textContent = message;
  statusEl.className = `status${type ? ` ${type}` : ''}`;
}

function normalizeNpaCode(value) {
  return value.replace(/\s/g, '').toUpperCase();
}

function isValidNpaCode(npaCode) {
  return /^[A-Z0-9]{12,13}$/.test(npaCode);
}

function isValidCoupon(coupon) {
  return coupon.length >= 4 && coupon.length <= 42 && !/\s/.test(coupon);
}

function isValidNickname(nickname) {
  return nickname.trim().length >= 1 && nickname.trim().length <= 20;
}

function createId() {
  return crypto.randomUUID();
}

function getProfileById(id) {
  return profiles.find((profile) => profile.id === id) || null;
}

function isNewProfileMode() {
  const value = profileSelect.value;
  return !value || value === NEW_PROFILE_VALUE;
}

function updateProfileControls() {
  const isNew = isNewProfileMode();
  const selectedId = profileSelect.value;
  const index = profiles.findIndex((profile) => profile.id === selectedId);

  saveBtn.textContent = isNew ? '추가' : '수정';
  deleteBtn.disabled = isNew;
  moveUpBtn.disabled = isNew || index <= 0;
  moveDownBtn.disabled = isNew || index < 0 || index >= profiles.length - 1;
  setDefaultBtn.disabled = isNew || selectedId === activeProfileId;
}

function renderProfileSelect() {
  profileSelect.innerHTML = '';

  const newOption = document.createElement('option');
  newOption.value = NEW_PROFILE_VALUE;
  newOption.textContent = '+ 새 계정 추가';
  profileSelect.appendChild(newOption);

  if (profiles.length === 0) {
    profileSelect.value = NEW_PROFILE_VALUE;
    nicknameInput.value = '';
    npaInput.value = '';
    updateProfileControls();
    return;
  }

  profiles.forEach((profile) => {
    const option = document.createElement('option');
    option.value = profile.id;
    const prefix = profile.id === activeProfileId ? '★ ' : '';
    option.textContent = `${prefix}${profile.nickname} (${profile.npaCode})`;
    profileSelect.appendChild(option);
  });

  updateProfileControls();
}

async function getStorageData() {
  return chrome.storage.sync.get([
    PROFILES_KEY,
    ACTIVE_PROFILE_KEY,
    AUTO_SELECT_KEY,
    LEGACY_NPA_KEY,
  ]);
}

async function migrateLegacyStorage(data) {
  if (!data[LEGACY_NPA_KEY]) return data;

  const legacyCode = normalizeNpaCode(data[LEGACY_NPA_KEY]);
  if (!isValidNpaCode(legacyCode)) {
    await chrome.storage.sync.remove(LEGACY_NPA_KEY);
    return data;
  }

  const existing = Array.isArray(data[PROFILES_KEY]) ? data[PROFILES_KEY] : [];
  if (existing.some((profile) => profile.npaCode === legacyCode)) {
    await chrome.storage.sync.remove(LEGACY_NPA_KEY);
    return data;
  }

  const profile = {
    id: createId(),
    nickname: '기본',
    npaCode: legacyCode,
  };

  const profiles = [...existing, profile];
  await chrome.storage.sync.set({
    [PROFILES_KEY]: profiles,
    [ACTIVE_PROFILE_KEY]: profile.id,
  });
  await chrome.storage.sync.remove(LEGACY_NPA_KEY);

  return {
    ...data,
    [PROFILES_KEY]: profiles,
    [ACTIVE_PROFILE_KEY]: profile.id,
  };
}

async function saveProfiles(nextProfiles, nextActiveProfileId) {
  profiles = nextProfiles;
  if (nextActiveProfileId) {
    activeProfileId = nextActiveProfileId;
  }
  await chrome.storage.sync.set({
    [PROFILES_KEY]: profiles,
    [ACTIVE_PROFILE_KEY]: activeProfileId,
  });
  renderProfileSelect();
  if (activeProfileId && profiles.some((profile) => profile.id === activeProfileId)) {
    profileSelect.value = activeProfileId;
    fillFormFromProfile(getProfileById(activeProfileId));
  }
}

async function moveSelectedProfile(direction) {
  const selectedId = profileSelect.value;
  if (isNewProfileMode() || !selectedId) return;

  const index = profiles.findIndex((profile) => profile.id === selectedId);
  if (index === -1) return;

  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= profiles.length) return;

  const nextProfiles = [...profiles];
  [nextProfiles[index], nextProfiles[targetIndex]] = [
    nextProfiles[targetIndex],
    nextProfiles[index],
  ];

  await saveProfiles(nextProfiles, activeProfileId);
  profileSelect.value = selectedId;
  updateProfileControls();
  setStatus('계정 순서를 변경했습니다.', 'ok');
}

function fillFormFromProfile(profile) {
  if (!profile) {
    nicknameInput.value = '';
    npaInput.value = '';
    updateProfileControls();
    return;
  }

  nicknameInput.value = profile.nickname;
  npaInput.value = profile.npaCode;
  updateProfileControls();
}

function selectNewProfileMode() {
  profileSelect.value = NEW_PROFILE_VALUE;
  fillFormFromProfile(null);
  setStatus('새 계정 정보를 입력한 뒤 추가하세요.');
}

async function loadSettings() {
  let data = await getStorageData();
  data = await migrateLegacyStorage(data);

  profiles = Array.isArray(data[PROFILES_KEY]) ? data[PROFILES_KEY] : [];
  activeProfileId = data[ACTIVE_PROFILE_KEY] || profiles[0]?.id || '';
  autoSelectInput.checked = Boolean(data[AUTO_SELECT_KEY]);

  renderProfileSelect();

  const activeId = data[ACTIVE_PROFILE_KEY] || profiles[0]?.id || '';
  if (activeId) {
    profileSelect.value = activeId;
    fillFormFromProfile(getProfileById(activeId));
  }

  const last = await chrome.storage.local.get(LAST_RESULT_KEY);
  const lastResult = last[LAST_RESULT_KEY];
  if (lastResult?.message) {
    setStatus(lastResult.message, lastResult.ok ? 'ok' : 'err');
  }
}

profileSelect.addEventListener('change', async () => {
  const profileId = profileSelect.value;
  if (isNewProfileMode()) {
    fillFormFromProfile(null);
    return;
  }

  await chrome.storage.sync.set({ [ACTIVE_PROFILE_KEY]: profileId });
  fillFormFromProfile(getProfileById(profileId));
  setStatus('');
});

document.getElementById('newProfile').addEventListener('click', () => {
  selectNewProfileMode();
});

moveUpBtn.addEventListener('click', () => {
  moveSelectedProfile('up');
});

moveDownBtn.addEventListener('click', () => {
  moveSelectedProfile('down');
});

setDefaultBtn.addEventListener('click', async () => {
  const selectedId = profileSelect.value;
  if (isNewProfileMode() || !selectedId) return;

  activeProfileId = selectedId;
  await chrome.storage.sync.set({ [ACTIVE_PROFILE_KEY]: selectedId });
  renderProfileSelect();
  profileSelect.value = selectedId;
  updateProfileControls();

  const profile = getProfileById(selectedId);
  setStatus(`"${profile.nickname}"을(를) 기본 계정으로 설정했습니다.`, 'ok');
});

document.getElementById('saveProfile').addEventListener('click', async () => {
  const nickname = nicknameInput.value.trim();
  const npaCode = normalizeNpaCode(npaInput.value);

  if (!isValidNickname(nickname)) {
    setStatus('별명을 1~20자로 입력하세요.', 'err');
    return;
  }
  if (!isValidNpaCode(npaCode)) {
    setStatus('회원코드는 12~13자 영문/숫자여야 합니다.', 'err');
    return;
  }

  const selectedId = profileSelect.value;
  const isNew = isNewProfileMode();
  const duplicate = profiles.find((profile) => {
    if (profile.npaCode !== npaCode) return false;
    return isNew || profile.id !== selectedId;
  });

  if (duplicate) {
    setStatus(`이미 "${duplicate.nickname}"에 등록된 회원코드입니다.`, 'err');
    return;
  }

  if (isNew) {
    const profile = { id: createId(), nickname, npaCode };
    profiles = [...profiles, profile];
    activeProfileId = profile.id;
    setStatus(`"${nickname}" 계정을 추가했습니다.`, 'ok');
  } else {
    profiles = profiles.map((profile) =>
      profile.id === selectedId
        ? { ...profile, nickname, npaCode }
        : profile,
    );
    setStatus(`"${nickname}" 계정을 수정했습니다.`, 'ok');
  }

  await saveProfiles(profiles, activeProfileId);
  npaInput.value = npaCode;
});

document.getElementById('deleteProfile').addEventListener('click', async () => {
  const selectedId = profileSelect.value;
  if (!selectedId) return;

  const target = getProfileById(selectedId);
  if (!target) return;

  profiles = profiles.filter((profile) => profile.id !== selectedId);
  const nextActiveId = profiles[0]?.id || '';

  await saveProfiles(profiles, nextActiveId);
  setStatus(`"${target.nickname}" 계정을 삭제했습니다.`, 'ok');
});

document.getElementById('apply').addEventListener('click', async () => {
  const selectedId = profileSelect.value;
  const profile = getProfileById(selectedId);
  const npaCode = normalizeNpaCode(npaInput.value);
  const coupon = couponInput.value.trim().toUpperCase();
  const autoSelectChar = autoSelectInput.checked;

  if (!profile && !isValidNpaCode(npaCode)) {
    setStatus('계정을 선택하거나 회원코드를 저장하세요.', 'err');
    return;
  }
  if (!isValidNpaCode(npaCode)) {
    setStatus('회원코드를 확인하세요 (12~13자).', 'err');
    return;
  }
  if (!isValidCoupon(coupon)) {
    setStatus('쿠폰번호를 확인하세요 (4~42자, 공백 없음).', 'err');
    return;
  }

  await chrome.storage.sync.set({
    [AUTO_SELECT_KEY]: autoSelectChar,
    [ACTIVE_PROFILE_KEY]: selectedId || profile?.id || '',
  });

  const applyBtn = document.getElementById('apply');
  applyBtn.disabled = true;
  setStatus('쿠폰 페이지를 열고 적용 중입니다...', '');

  chrome.runtime.sendMessage(
    {
      type: 'APPLY_COUPON_REQUEST',
      payload: {
        npaCode,
        coupon,
        autoSelectChar,
        label: profile?.nickname || '선택한 계정',
      },
    },
    (response) => {
      applyBtn.disabled = false;

      if (chrome.runtime.lastError) {
        setStatus('백그라운드 연결 실패. 확장을 새로고침하세요.', 'err');
        return;
      }

      if (!response?.ok) {
        setStatus(response?.error || '적용에 실패했습니다.', 'err');
        return;
      }

      setStatus(response.result?.message || '적용을 완료했습니다.', response.result?.ok ? 'ok' : 'err');
    },
  );
});

loadSettings();
