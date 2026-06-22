const COUPON_URL = 'https://mcoupon.nexon.com/mabinogimobile/';
const LAST_RESULT_KEY = 'lastApplyResult';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCouponUrl(url) {
  return typeof url === 'string' && url.includes('mcoupon.nexon.com/mabinogimobile');
}

async function findCouponTab() {
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => isCouponUrl(tab.url)) ?? null;
}

async function waitForTabComplete(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === 'complete') return;

  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 30000);
    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function pingContentScript(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return Boolean(response?.ok);
  } catch {
    return false;
  }
}

async function waitForContentScript(tabId, retries = 40) {
  for (let i = 0; i < retries; i++) {
    if (await pingContentScript(tabId)) return true;
    await sleep(300);
  }
  return false;
}

async function ensureContentScript(tabId, reloaded = false) {
  if (await waitForContentScript(tabId, 10)) return true;

  if (!reloaded) {
    await chrome.tabs.reload(tabId);
    await waitForTabComplete(tabId);
    await sleep(1200);
    return ensureContentScript(tabId, true);
  }

  return false;
}

async function sendApplyMessage(tabId, payload) {
  return chrome.tabs.sendMessage(tabId, {
    type: 'APPLY_COUPON',
    npaCode: payload.npaCode,
    coupon: payload.coupon,
    autoSelectChar: payload.autoSelectChar,
  });
}

async function ensureCouponTab() {
  const existing = await findCouponTab();
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    await sleep(400);
    return { tabId: existing.id, opened: false };
  }

  const tab = await chrome.tabs.create({ url: COUPON_URL, active: true });
  await waitForTabComplete(tab.id);
  await sleep(1500);
  return { tabId: tab.id, opened: true };
}

async function saveLastResult(result) {
  await chrome.storage.local.set({
    [LAST_RESULT_KEY]: {
      ...result,
      at: Date.now(),
    },
  });
}

async function setBadge(ok) {
  await chrome.action.setBadgeText({ text: ok ? 'OK' : '!' });
  await chrome.action.setBadgeBackgroundColor({
    color: ok ? '#047857' : '#b91c1c',
  });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
  }, 5000);
}

async function applyCouponRequest(payload) {
  const { tabId, opened } = await ensureCouponTab();
  const ready = await ensureContentScript(tabId);

  if (!ready) {
    throw new Error('쿠폰 페이지 연결에 실패했습니다. 페이지를 새로고침 후 다시 시도하세요.');
  }

  const response = await sendApplyMessage(tabId, payload);

  const label = payload.label || '선택한 계정';
  const message = response?.ok
    ? `[${label}] ${response.message || '적용 완료'}`
    : response?.message || '적용에 실패했습니다.';

  await saveLastResult({
    ok: Boolean(response?.ok),
    message,
    opened,
  });
  await setBadge(Boolean(response?.ok));

  return { ok: Boolean(response?.ok), message, opened };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'APPLY_COUPON_REQUEST') return;

  applyCouponRequest(message.payload)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => {
      const failMessage = error?.message || '페이지 연결에 실패했습니다.';
      saveLastResult({ ok: false, message: failMessage, opened: false });
      setBadge(false);
      sendResponse({ ok: false, error: failMessage });
    });

  return true;
});
