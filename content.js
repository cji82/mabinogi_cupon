const PROFILES_KEY = 'profiles';
const ACTIVE_PROFILE_KEY = 'activeProfileId';
const LEGACY_NPA_KEY = 'npaCode';
const API_BASE = '/mabinogimobile/coupon/api/v1';

const SELECTORS = {
  npaInput: '#eRedeemNpaCode',
  couponInput: '#eRedeemCoupon',
  redeemTab: 'li.redeem-tab-li > a',
  characterList: 'ul.e-redeem-character-list',
  characterArea: '.e-redeem-character-area',
  noticeArea: '.e-redeem-notice-area',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function switchToRedeemTab() {
  const tab = document.querySelector(SELECTORS.redeemTab);
  if (tab && !document.querySelector('#tab2.active')) {
    tab.click();
  }
}

function setInputValue(selector, value) {
  const el = document.querySelector(selector);
  if (!el) return false;

  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;

  if (nativeSetter) {
    nativeSetter.call(el, value);
  } else {
    el.value = value;
  }

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function fillForm(npaCode, coupon) {
  switchToRedeemTab();
  setInputValue(SELECTORS.npaInput, npaCode);
  setInputValue(SELECTORS.couponInput, coupon);
}

async function waitForRedeemForm(timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const npa = document.querySelector(SELECTORS.npaInput);
    const coupon = document.querySelector(SELECTORS.couponInput);
    if (npa && coupon) return true;
    await sleep(200);
  }
  return false;
}

async function postJson(path, body) {
  const response = await fetch(`${API_BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`서버 오류 (${response.status})`);
  }

  return response.json();
}

function formatApiError(data) {
  const code = Number(data?.code);
  switch (code) {
    case 94201:
      return '회원코드를 확인하세요.';
    case 94202:
      return '쿠폰번호를 확인하세요.';
    case 95130:
      return '이미 사용된 쿠폰이거나 유효하지 않습니다.';
    case 1171:
      return '쿠폰 사용 제한에 걸렸습니다.';
    default:
      if (data?.message) return data.message;
      if (code) return `오류 코드: ${code}`;
      return '요청에 실패했습니다.';
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showPageAlert(title, message) {
  const popup = document.querySelector('#popAlert');
  if (!popup) {
    window.alert(message);
    return;
  }

  const titleEl = popup.querySelector('h4');
  const messageEl = popup.querySelector('.pop_msg');
  if (titleEl) titleEl.textContent = title;
  if (messageEl) messageEl.textContent = message;

  popup.classList.add('on');
  document.body.style.overflow = 'hidden';
}

function showInlineMessage(message, type = 'fail') {
  const box = document.querySelector('.system_msg.system2');
  if (!box) return;

  const className = type === 'success' ? 'success_msg' : 'fail_msg';
  box.innerHTML = `<p class="${className}">${escapeHtml(message)}</p>`;
}

function showPageError(message, title = '쿠폰 사용 안내') {
  showPageAlert(title, message);
  showInlineMessage(message, 'fail');
}

function showPageSuccess(message, title = '쿠폰 사용 완료') {
  showPageAlert(title, message);
  showInlineMessage(message, 'success');
}

function returnError(message, title = '쿠폰 사용 안내') {
  showPageError(message, title);
  return { ok: false, message };
}

function showCharacterArea() {
  const area = document.querySelector(SELECTORS.characterArea);
  const notice = document.querySelector(SELECTORS.noticeArea);
  if (area) area.style.display = 'block';
  if (notice) notice.style.display = 'none';
}

async function redeemCoupon(params) {
  return postJson('redeem-coupon-by-npacode', params);
}

function renderCharacterList(characters, npaCode, coupon) {
  const container = document.querySelector(SELECTORS.characterList);
  if (!container) return;

  container.innerHTML = '';

  characters.forEach((character) => {
    const li = document.createElement('li');
    li.className = 'e-redeem-character-list';
    const worldLabel = character.worldName ? `[${character.worldName}] ` : '';
    li.innerHTML = `
      <p class="char_name" style="text-align:center">${worldLabel}${character.name}</p>
      <p class="txt_select">선택</p>
    `;

    li.addEventListener('click', async () => {
      const confirmed = window.confirm(`${character.name} 캐릭터에 쿠폰을 지급할까요?`);
      if (!confirmed) return;

      const result = await redeemCoupon({
        npaCode,
        coupon,
        id: character.id,
        name: character.name,
        world: character.world,
      });

      if (Number(result.code) === 0) {
        showPageSuccess('쿠폰 사용이 완료되었습니다.');
      } else {
        showPageError(formatApiError(result));
      }
    });

    container.appendChild(li);
  });

  showCharacterArea();
}

async function applyCoupon({ npaCode, coupon, autoSelectChar }) {
  const ready = await waitForRedeemForm();
  if (!ready) {
    return returnError('페이지 로딩이 끝나지 않았습니다.');
  }

  const normalizedCoupon = coupon.toUpperCase();
  fillForm(npaCode, normalizedCoupon);

  let charData;
  try {
    charData = await postJson('characters-by-npacode', {
      npaCode,
      coupon: normalizedCoupon,
    });
  } catch (error) {
    return returnError(error.message || '캐릭터 조회에 실패했습니다.');
  }

  if (!charData?.result || !Array.isArray(charData.info) || charData.info.length === 0) {
    return returnError(formatApiError(charData));
  }

  const characters = charData.info;

  if (autoSelectChar && characters.length === 1) {
    const character = characters[0];
    let redeemData;
    try {
      redeemData = await redeemCoupon({
        npaCode,
        coupon: normalizedCoupon,
        id: character.id,
        name: character.name,
        world: character.world,
      });
    } catch (error) {
      return returnError(error.message || '쿠폰 등록에 실패했습니다.');
    }

    if (Number(redeemData.code) === 0) {
      showPageSuccess(`${character.name} 캐릭터에 쿠폰을 등록했습니다.`);
      return { ok: true, message: `${character.name} 캐릭터에 쿠폰을 등록했습니다.` };
    }

    return returnError(formatApiError(redeemData));
  }

  renderCharacterList(characters, npaCode, normalizedCoupon);
  const listMessage =
    characters.length === 1
      ? '캐릭터 1명 조회됨. 아래에서 선택하세요.'
      : `캐릭터 ${characters.length}명 조회됨. 아래에서 선택하세요.`;
  showInlineMessage(listMessage, 'success');

  return { ok: true, message: listMessage };
}

async function getActiveNpaCode() {
  const data = await chrome.storage.sync.get([
    PROFILES_KEY,
    ACTIVE_PROFILE_KEY,
    LEGACY_NPA_KEY,
  ]);

  const profiles = Array.isArray(data[PROFILES_KEY]) ? data[PROFILES_KEY] : [];
  if (profiles.length > 0) {
    const active =
      profiles.find((profile) => profile.id === data[ACTIVE_PROFILE_KEY]) ||
      profiles[0];
    return active?.npaCode || null;
  }

  return data[LEGACY_NPA_KEY] || null;
}

async function fillSavedNpaCode() {
  const npaCode = await getActiveNpaCode();
  if (!npaCode) return;

  const tryFill = async () => {
    const input = document.querySelector(SELECTORS.npaInput);
    if (!input) return false;
    if (!input.value) {
      switchToRedeemTab();
      setInputValue(SELECTORS.npaInput, npaCode);
    }
    return true;
  };

  if (!(await tryFill())) {
    const observer = new MutationObserver(() => {
      tryFill().then((done) => {
        if (done) observer.disconnect();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 10000);
  }
}

function registerMessageListener() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'PING') {
      sendResponse({ ok: true });
      return;
    }

    if (message?.type !== 'APPLY_COUPON') return;

    applyCoupon(message)
      .then(sendResponse)
      .catch((error) => {
        const message = error.message || '알 수 없는 오류';
        showPageError(message);
        sendResponse({ ok: false, message });
      });

    return true;
  });
}

registerMessageListener();

if (!window.__mabinogiCouponExtensionInit) {
  window.__mabinogiCouponExtensionInit = true;

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes[ACTIVE_PROFILE_KEY] || changes[PROFILES_KEY]) {
      fillSavedNpaCode();
    }
  });

  fillSavedNpaCode();
}
