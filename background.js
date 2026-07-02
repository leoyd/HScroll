/**
 * Table Horizontal Scroll Helper
 * SPDX-License-Identifier: MIT
 */
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!sender.tab || !message || message.type !== 'HSS_COUNT') {
    return;
  }

  const count = Number(message.count || 0);
  chrome.action.setBadgeText({
    tabId: sender.tab.id,
    text: count > 0 ? String(Math.min(count, 99)) : '',
  });
  chrome.action.setBadgeBackgroundColor({
    tabId: sender.tab.id,
    color: '#325B9A',
  });
  chrome.action.setTitle({
    tabId: sender.tab.id,
    title: count > 0
      ? `${count} zone(s) de scroll horizontal détectée(s)`
      : 'Aucune zone de scroll horizontal détectée',
  });
});
