/**
 * Table Horizontal Scroll Helper
 * SPDX-License-Identifier: MIT
 */
(() => {
  'use strict';

  const ATTR = 'data-hss-enhanced';
  const OVERLAY_CLASS = 'hss-overlay';
  const MIN_OVERFLOW = 24;
  const MIN_WIDTH = 220;
  const MAX_TARGETS = 30;
  const SNAP_TO_END_THRESHOLD = 96;
  const EDGE_WIDTH = 40;
  const SCAN_DELAY = 180;

  const enhanced = new WeakMap();
  let scanTimer = null;
  let lastCount = -1;

  const candidateSelectors = [
    '.boards-list',
    '.datatable-container',
    '.dataTables_scrollBody',
    '.table-responsive',
    '.table-wrapper',
    '[role="grid"]',
    '[role="table"]',
    '[class*="overflow-x-auto"]',
    '[class*="overflow-x-scroll"]',
    '[class*="gl-overflow-x-auto"]',
    '[class*="gl-overflow-x-scroll"]',
    'table',
  ].join(',');

  function debounceScan() {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scan, SCAN_DELAY);
  }

  function isVisible(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width >= MIN_WIDTH && rect.height >= 36 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function canScrollX(el) {
    if (!el) return false;

    if (el.scrollWidth - el.clientWidth > MIN_OVERFLOW) {
      return true;
    }

    // Some table components render a wide table inside a container whose
    // scrollbar is initialized later or hidden by CSS. Treat the real content
    // width as a scroll signal so the helper is attached immediately.
    const rect = el.getBoundingClientRect();
    const contentRect = getScrollableContentRect(el);

    return Boolean(contentRect && contentRect.width - rect.width > MIN_OVERFLOW);
  }

  function getOverflowX(el) {
    const value = window.getComputedStyle(el).overflowX;
    return value === 'auto' || value === 'scroll' || value === 'overlay';
  }

  function findScrollableAncestor(el) {
    let current = el;
    while (current && current !== document.documentElement && current !== document.body) {
      if (canScrollX(current) && (getOverflowX(current) || current.matches('.boards-list, .datatable-container, .dataTables_scrollBody, .table-responsive, [role="grid"], [role="table"]'))) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function collectTargets() {
    const nodes = Array.from(document.querySelectorAll(candidateSelectors));
    const found = new Set();

    for (const node of nodes) {
      const target = node.tagName === 'TABLE' ? findScrollableAncestor(node.parentElement || node) : findScrollableAncestor(node) || node;
      if (!target || target === document.body || target === document.documentElement) continue;
      if (!isVisible(target) || !canScrollX(target)) continue;
      found.add(target);
    }

    // Fallback: any visible element with real horizontal overflow.
    if (found.size === 0) {
      for (const node of Array.from(document.querySelectorAll('div, section, main, article'))) {
        if (found.size >= MAX_TARGETS) break;
        if (node === document.body || node === document.documentElement) continue;
        if (!isVisible(node) || !canScrollX(node)) continue;
        if (!getOverflowX(node)) continue;
        found.add(node);
      }
    }

    return Array.from(found)
      .filter((target) => !hasScrollableAncestorInSet(target, found))
      .slice(0, MAX_TARGETS);
  }

  function hasScrollableAncestorInSet(target, set) {
    let parent = target.parentElement;
    while (parent && parent !== document.body && parent !== document.documentElement) {
      if (set.has(parent) && canScrollX(parent)) return true;
      parent = parent.parentElement;
    }
    return false;
  }

  function sendCount(count) {
    if (count === lastCount) return;
    lastCount = count;
    try {
      chrome.runtime.sendMessage({ type: 'HSS_COUNT', count });
    } catch (_) {
      // Ignore when the extension context is reloaded during development.
    }
  }

  function scan() {
    const targets = collectTargets();
    for (const target of targets) enhance(target);
    cleanupDetachedOverlays();
    sendCount(targets.length);
  }

  function cleanupDetachedOverlays() {
    for (const overlay of document.querySelectorAll(`.${OVERLAY_CLASS}`)) {
      const id = overlay.dataset.hssTargetId;
      if (!id || document.querySelector(`[data-hss-id="${CSS.escape(id)}"]`)) continue;
      overlay.remove();
    }
  }

  function enhance(target) {
    if (enhanced.has(target)) {
      enhanced.get(target).update();
      return;
    }

    const id = `hss-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    target.setAttribute(ATTR, 'true');
    target.dataset.hssId = id;

    const left = createOverlay('left', id);
    const right = createOverlay('right', id);
    document.documentElement.append(left, right);

    const state = { target, left, right, hover: false, raf: 0, pointerX: null, pointerY: null, suppressHoverUntilMove: false };

    const update = () => requestUpdate(state);
    const onScroll = update;
    const onMouseEnter = (event) => {
      state.hover = true;
      rememberPointer(state, event);
      update();
    };
    const onMouseLeave = (event) => {
      rememberPointer(state, event);
      const to = event.relatedTarget;
      if (to && (left.contains(to) || right.contains(to))) return;
      state.hover = false;
      update();
    };
    const onWindowChange = update;
    const onDocumentPointerMove = (event) => {
      rememberPointer(state, event);
      state.suppressHoverUntilMove = false;
      const inside = isPointerInsideTargetOrOverlay(state, event.clientX, event.clientY);

      if (inside !== state.hover) {
        state.hover = inside;
        update();
      } else if (inside) {
        update();
      }
    };

    left.addEventListener('mouseenter', onMouseEnter);
    right.addEventListener('mouseenter', onMouseEnter);
    left.addEventListener('mouseleave', (event) => { rememberPointer(state, event); state.hover = false; update(); });
    right.addEventListener('mouseleave', (event) => { rememberPointer(state, event); state.hover = false; update(); });
    left.addEventListener('mousemove', (event) => { rememberPointer(state, event); state.suppressHoverUntilMove = false; validateHoverState(state); });
    right.addEventListener('mousemove', (event) => { rememberPointer(state, event); state.suppressHoverUntilMove = false; validateHoverState(state); });
    left.addEventListener('pointerdown', (event) => { rememberPointer(state, event); });
    right.addEventListener('pointerdown', (event) => { rememberPointer(state, event); });
    left.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      rememberPointer(state, event);
      settleAfterClick(state, -1);
      scrollTarget(target, -1);
      scheduleHoverValidation(state);
    });
    right.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      rememberPointer(state, event);
      settleAfterClick(state, 1);
      scrollTarget(target, 1);
      scheduleHoverValidation(state);
    });
    target.addEventListener('scroll', onScroll, { passive: true });
    target.addEventListener('mouseenter', onMouseEnter);
    target.addEventListener('mousemove', (event) => { rememberPointer(state, event); state.suppressHoverUntilMove = false; validateHoverState(state); });
    target.addEventListener('mouseleave', onMouseLeave);
    document.addEventListener('mousemove', onDocumentPointerMove, { passive: true, capture: true });
    window.addEventListener('resize', onWindowChange, { passive: true });
    window.addEventListener('scroll', onWindowChange, { passive: true, capture: true });

    const api = {
      update,
      destroy() {
        left.remove();
        right.remove();
        target.removeEventListener('scroll', onScroll);
        target.removeEventListener('mouseenter', onMouseEnter);
        target.removeEventListener('mouseleave', onMouseLeave);
        document.removeEventListener('mousemove', onDocumentPointerMove, true);
        window.removeEventListener('resize', onWindowChange);
        window.removeEventListener('scroll', onWindowChange, true);
      },
    };

    enhanced.set(target, api);
    update();
  }

  function createOverlay(side, id) {
    const overlay = document.createElement('div');
    overlay.className = `${OVERLAY_CLASS} hss-${side}`;
    overlay.dataset.hssTargetId = id;
    overlay.innerHTML = `
      <span class="hss-shadow" aria-hidden="true"></span>
      <button class="hss-button" type="button" aria-label="${side === 'left' ? 'Faire défiler vers la gauche' : 'Faire défiler vers la droite'}">
        <span class="hss-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="${side === 'left' ? 'M14.7 6.3 9 12l5.7 5.7' : 'M9.3 6.3 15 12l-5.7 5.7'}" />
          </svg>
        </span>
      </button>
    `;
    return overlay;
  }

  function settleAfterClick(state, direction) {
    // Do not force-hide after a click. If the pointer is still hovering the
    // table/edge and there is still a scrollable direction, keep the hover
    // affordance visible. If the pointer is no longer on the interactive area,
    // hide it immediately. This avoids the stuck hover state without making the
    // control disappear while the user is still intentionally using it.
    state.suppressHoverUntilMove = false;
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      try { document.activeElement.blur(); } catch (_) {}
    }
    refreshHoverAfterClick(state, direction);
  }

  function refreshHoverAfterClick(state, direction) {
    if (state.pointerX === null || state.pointerY === null) {
      state.hover = false;
      requestUpdate(state);
      return;
    }

    const inside = isPointerInsideTargetOrOverlay(state, state.pointerX, state.pointerY);
    state.hover = inside && hasRemainingScroll(state.target, direction);
    requestUpdate(state);
  }

  function hasRemainingScroll(target, direction) {
    const maxScrollLeft = Math.max(0, target.scrollWidth - target.clientWidth);
    if (maxScrollLeft <= 1) return false;
    if (direction < 0) return target.scrollLeft > 1;
    return target.scrollLeft < maxScrollLeft - 1;
  }

  function rememberPointer(state, event) {
    if (!event || typeof event.clientX !== 'number' || typeof event.clientY !== 'number') return;
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
  }

  function scheduleHoverValidation(state) {
    window.setTimeout(() => validateHoverState(state), 60);
    window.setTimeout(() => validateHoverState(state), 180);
    window.setTimeout(() => validateHoverState(state), 360);
    window.setTimeout(() => validateHoverState(state), 720);
  }

  function validateHoverState(state) {
    if (state.pointerX === null || state.pointerY === null) return;

    const inside = isPointInsideInteractiveArea(state, state.pointerX, state.pointerY);
    if (inside === state.hover) {
      if (inside) requestUpdate(state);
      return;
    }

    state.hover = inside;
    requestUpdate(state);
  }

  function isPointInsideInteractiveArea(state, x, y) {
    return isPointerInsideTargetOrOverlay(state, x, y);
  }

  function isPointerInsideTargetOrOverlay(state, x, y) {
    if (rectContainsPoint(state.left.getBoundingClientRect(), x, y)
      || rectContainsPoint(state.right.getBoundingClientRect(), x, y)) {
      return true;
    }

    if (!document.documentElement.contains(state.target)) return false;

    const targetRect = state.target.getBoundingClientRect();
    const contentRect = getOverlayRect(state.target, targetRect);

    // Prefer the real table/content rectangle when available so hovering empty
    // areas around the component does not keep the affordance visible, but keep
    // the target rectangle as a fallback for virtualized or custom grids.
    return rectContainsPoint(contentRect, x, y) || rectContainsPoint(targetRect, x, y);
  }

  function rectContainsPoint(rect, x, y) {
    return rect && rect.width > 0 && rect.height > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function requestUpdate(state) {
    if (state.raf) return;
    state.raf = window.requestAnimationFrame(() => {
      state.raf = 0;
      updateOverlayPosition(state);
    });
  }

  function updateOverlayPosition(state) {
    const { target, left, right } = state;
    if (!document.documentElement.contains(target) || !isVisible(target) || !canScrollX(target)) {
      left.remove();
      right.remove();
      enhanced.delete(target);
      debounceScan();
      return;
    }

    ensureElementCanScrollHorizontally(target);

    const targetRect = target.getBoundingClientRect();
    const rawVisibleRect = getOverlayRect(target, targetRect);
    const visibleRect = subtractExternalFixedObstructions(rawVisibleRect, target);
    const sticky = getStickyOffsets(target, visibleRect);
    const maxScrollLeft = target.scrollWidth - target.clientWidth;
    const atStart = target.scrollLeft <= 1;
    const atEnd = target.scrollLeft >= maxScrollLeft - 1;
    const commonTop = Math.round(visibleRect.top);
    const commonHeight = Math.max(0, Math.round(visibleRect.height));

    placeOverlay(left, {
      visible: state.hover && !state.suppressHoverUntilMove && !atStart && commonHeight > 24,
      side: 'left',
      x: visibleRect.left + sticky.left,
      top: commonTop,
      height: commonHeight,
    });

    placeOverlay(right, {
      visible: state.hover && !state.suppressHoverUntilMove && !atEnd && commonHeight > 24,
      side: 'right',
      x: visibleRect.right - sticky.right - EDGE_WIDTH,
      top: commonTop,
      height: commonHeight,
    });
  }

  function ensureElementCanScrollHorizontally(target) {
    if (target.scrollWidth - target.clientWidth > MIN_OVERFLOW) return;

    const style = window.getComputedStyle(target);
    if (style.overflowX === 'visible' || style.overflowX === 'hidden' || style.overflowX === 'clip') {
      const contentRect = getScrollableContentRect(target);
      const targetRect = target.getBoundingClientRect();
      if (contentRect && contentRect.width - targetRect.width > MIN_OVERFLOW) {
        target.style.overflowX = 'auto';
      }
    }
  }

  function placeOverlay(overlay, config) {
    overlay.classList.toggle('hss-visible', Boolean(config.visible));
    overlay.style.top = `${config.top}px`;
    overlay.style.height = `${config.height}px`;
    overlay.style.width = `${EDGE_WIDTH}px`;
    overlay.style.left = `${Math.round(config.x)}px`;
  }

  function getOverlayRect(target, targetRect) {
    const contentRect = getScrollableContentRect(target) || targetRect;
    const clippedToTarget = intersectRects(contentRect, targetRect);
    return intersectViewport(clippedToTarget || targetRect);
  }

  function getScrollableContentRect(target) {
    const selectors = [
      ':scope > table',
      'table',
      '[role="table"]',
      '[role="grid"]',
      '.boards-list',
      '[data-testid="boards-list"]',
      'thead',
      'tbody',
      'tr',
      '[role="rowgroup"]',
      '[role="row"]',
    ];

    const rects = [];
    const isBoard = target.matches('.boards-list, [data-testid="boards-list"]');

    if (isBoard) {
      for (const child of Array.from(target.children)) {
        pushUsefulRect(rects, child, target);
      }
    }

    for (const selector of selectors) {
      let items = [];
      try {
        items = Array.from(target.querySelectorAll(selector));
      } catch (_) {
        items = [];
      }
      for (const item of items) {
        if (item === target) continue;
        pushUsefulRect(rects, item, target);
      }
    }

    if (rects.length === 0 && target.tagName === 'TABLE') {
      pushUsefulRect(rects, target, target);
    }

    // Last fallback for non-table layouts: use only direct visible children so the shadow
    // stays aligned with real content instead of the whole empty scroll container.
    if (rects.length === 0) {
      for (const child of Array.from(target.children)) {
        pushUsefulRect(rects, child, target);
      }
    }

    if (rects.length === 0) return null;
    return unionRects(rects);
  }

  function pushUsefulRect(rects, item, target) {
    if (!item || item.nodeType !== Node.ELEMENT_NODE) return;
    const rect = item.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const style = window.getComputedStyle(item);

    if (style.display === 'none' || style.visibility === 'hidden') return;
    if (rect.width < 24 || rect.height < 12) return;

    // Keep only elements that actually overlap the scrollable area.
    if (!intersectRects(rect, targetRect)) return;

    rects.push(rect);
  }

  function unionRects(rects) {
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    let left = Infinity;

    for (const rect of rects) {
      top = Math.min(top, rect.top);
      right = Math.max(right, rect.right);
      bottom = Math.max(bottom, rect.bottom);
      left = Math.min(left, rect.left);
    }

    return { top, right, bottom, left, width: right - left, height: bottom - top };
  }

  function intersectRects(a, b) {
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    const left = Math.max(a.left, b.left);

    if (right <= left || bottom <= top) return null;
    return { top, right, bottom, left, width: right - left, height: bottom - top };
  }

  function intersectViewport(rect) {
    return {
      top: Math.max(0, rect.top),
      bottom: Math.min(window.innerHeight, rect.bottom),
      left: Math.max(0, rect.left),
      right: Math.min(window.innerWidth, rect.right),
      get width() { return Math.max(0, this.right - this.left); },
      get height() { return Math.max(0, this.bottom - this.top); },
    };
  }

  function getStickyOffsets(target, visibleRect) {
    return {
      right: getPositionedEdgeOffset(target, visibleRect, 'right'),
      left: getPositionedEdgeOffset(target, visibleRect, 'left'),
    };
  }

  function getPositionedEdgeOffset(target, visibleRect, side) {
    let offset = 0;
    const candidates = Array.from(target.querySelectorAll('th, td, [role="columnheader"], [role="gridcell"], [role="cell"], [style*="position"]'));

    for (const item of candidates) {
      if (!isVisibleCell(item)) continue;
      const style = window.getComputedStyle(item);
      if (style.position !== 'sticky' && style.position !== 'fixed') continue;

      const rect = item.getBoundingClientRect();
      if (!rectsOverlapVertically(rect, visibleRect)) continue;

      if (side === 'right' && isPinnedToRightEdge(rect, visibleRect, style)) {
        offset = Math.max(offset, Math.max(0, visibleRect.right - rect.left));
      }

      if (side === 'left' && isPinnedToLeftEdge(rect, visibleRect, style)) {
        offset = Math.max(offset, Math.max(0, rect.right - visibleRect.left));
      }
    }

    return Math.min(offset, Math.max(0, visibleRect.width - EDGE_WIDTH - 24));
  }

  function isPinnedToRightEdge(rect, visibleRect, style) {
    const declaredRight = parseCssPx(style.right);
    const closeToRight = rect.right >= visibleRect.right - 24 || rect.left >= visibleRect.right - 220;
    return closeToRight && declaredRight !== null;
  }

  function isPinnedToLeftEdge(rect, visibleRect, style) {
    const declaredLeft = parseCssPx(style.left);
    const closeToLeft = rect.left <= visibleRect.left + 24 || rect.right <= visibleRect.left + 220;
    return closeToLeft && declaredLeft !== null;
  }

  function parseCssPx(value) {
    if (!value || value === 'auto') return null;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function rectsOverlapVertically(a, b) {
    return a.bottom > b.top && a.top < b.bottom;
  }

  function subtractExternalFixedObstructions(rect, target) {
    if (!rect || rect.height <= 0 || rect.width <= 0) return rect;

    let top = rect.top;
    let bottom = rect.bottom;

    for (const blockerRect of collectExternalViewportBlockers(target)) {
      if (!rectsOverlapHorizontally(blockerRect, rect)) continue;
      if (!rectsOverlapVertically(blockerRect, { top, bottom })) continue;

      const blocksFromTop = blockerRect.top <= top + 2 && blockerRect.bottom > top;
      const blocksFromBottom = blockerRect.bottom >= bottom - 2 && blockerRect.top < bottom;

      if (blocksFromTop) top = Math.max(top, Math.min(blockerRect.bottom, bottom));
      if (blocksFromBottom) bottom = Math.min(bottom, Math.max(blockerRect.top, top));
    }

    top = refineTopAgainstViewportHitTesting(top, bottom, rect, target);
    bottom = refineBottomAgainstViewportHitTesting(top, bottom, rect, target);

    return {
      top,
      bottom,
      left: rect.left,
      right: rect.right,
      width: rect.width,
      height: Math.max(0, bottom - top),
    };
  }

  function refineTopAgainstViewportHitTesting(top, bottom, rect, target) {
    const maxProbe = Math.min(bottom, top + 180, window.innerHeight);
    let refinedTop = top;

    for (let y = Math.max(0, Math.floor(top)); y < maxProbe; y += 2) {
      if (hasExternalViewportLayerAt(rect, y, target)) {
        refinedTop = y + 2;
        continue;
      }
      break;
    }

    return Math.min(refinedTop, bottom);
  }

  function refineBottomAgainstViewportHitTesting(top, bottom, rect, target) {
    const minProbe = Math.max(top, bottom - 180, 0);
    let refinedBottom = bottom;

    for (let y = Math.min(window.innerHeight - 1, Math.ceil(bottom)); y > minProbe; y -= 2) {
      if (hasExternalViewportLayerAt(rect, y, target)) {
        refinedBottom = y - 2;
        continue;
      }
      break;
    }

    return Math.max(refinedBottom, top);
  }

  function hasExternalViewportLayerAt(rect, y, target) {
    const sampleXs = [
      rect.left + Math.min(8, rect.width / 3),
      rect.left + rect.width / 2,
      rect.right - Math.min(8, rect.width / 3),
    ];

    return sampleXs.some((x) => {
      if (x < 0 || x > window.innerWidth || y < 0 || y > window.innerHeight) return false;
      const stack = document.elementsFromPoint(x, y);
      return stack.some((el) => isExternalViewportLayer(el, target));
    });
  }

  function isExternalViewportLayer(el, target) {
    let current = el;
    while (current && current !== document.documentElement && current !== document.body) {
      if (current === target || target.contains(current)) return false;
      if (current.classList && current.classList.contains(OVERLAY_CLASS)) return false;

      const style = window.getComputedStyle(current);
      if (style.position === 'fixed' || style.position === 'sticky') {
        const rect = current.getBoundingClientRect();
        if (rect.width >= 40 && rect.height >= 8 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
          return true;
        }
      }

      current = current.parentElement;
    }
    return false;
  }

  function collectExternalViewportBlockers(target) {
    const blockers = [];
    const nodes = Array.from(document.body ? document.body.querySelectorAll('*') : []);

    for (const node of nodes) {
      if (node === target || target.contains(node)) continue;
      if (node.classList && node.classList.contains(OVERLAY_CLASS)) continue;

      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
      if (style.position !== 'fixed' && style.position !== 'sticky') continue;

      const rect = getViewportBlockerRect(node, style);
      if (!rect) continue;
      blockers.push(rect);
    }

    // Nearest top/bottom blockers first makes clipping deterministic for stacked fixed UI.
    blockers.sort((a, b) => {
      const aTopDistance = Math.min(Math.abs(a.top), Math.abs(window.innerHeight - a.bottom));
      const bTopDistance = Math.min(Math.abs(b.top), Math.abs(window.innerHeight - b.bottom));
      return aTopDistance - bTopDistance || b.width * b.height - a.width * a.height;
    });

    return blockers;
  }

  function getViewportBlockerRect(node, style) {
    const base = node.getBoundingClientRect();
    if (base.width < 40 || base.height < 8) return null;
    if (base.bottom <= 0 || base.top >= window.innerHeight || base.right <= 0 || base.left >= window.innerWidth) return null;

    let top = base.top;
    let right = base.right;
    let bottom = base.bottom;
    let left = base.left;

    for (const pseudo of ['::before', '::after']) {
      const pseudoRect = estimatePseudoRect(node, pseudo, base);
      if (!pseudoRect) continue;
      top = Math.min(top, pseudoRect.top);
      right = Math.max(right, pseudoRect.right);
      bottom = Math.max(bottom, pseudoRect.bottom);
      left = Math.min(left, pseudoRect.left);
    }

    top = Math.max(-window.innerHeight, top);
    bottom = Math.min(window.innerHeight * 2, bottom);

    return {
      top,
      right,
      bottom,
      left,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }

  function estimatePseudoRect(node, pseudo, base) {
    const style = window.getComputedStyle(node, pseudo);
    if (!style || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return null;
    if (!style.content || style.content === 'none' || style.content === 'normal') return null;

    const height = parseCssPx(style.height) ?? 0;
    const width = parseCssPx(style.width) ?? base.width;
    const topValue = parseCssPx(style.top);
    const bottomValue = parseCssPx(style.bottom);
    const leftValue = parseCssPx(style.left);
    const rightValue = parseCssPx(style.right);

    // Generic pseudo-element approximation: browsers do not expose pseudo-element
    // rectangles, so we reconstruct the most common fixed/sticky decoration cases
    // from computed position values. This covers before/after bars, borders and
    // overlays without relying on any specific class name.
    let top = base.top;
    if (topValue !== null) {
      top = base.top + topValue;
    } else if (bottomValue !== null && height > 0) {
      top = base.bottom - bottomValue - height;
    }

    const effectiveHeight = height > 0 ? height : Math.min(base.height, 24);
    let left = base.left;
    if (leftValue !== null) {
      left = base.left + leftValue;
    } else if (rightValue !== null && width > 0) {
      left = base.right - rightValue - width;
    }

    const effectiveWidth = width > 0 ? width : base.width;
    const rect = {
      top,
      right: left + effectiveWidth,
      bottom: top + effectiveHeight,
      left,
    };

    // If the pseudo-element is absolutely positioned outside the element, keep it.
    // If it is just normal inline decoration, its approximation remains inside base.
    rect.width = Math.max(0, rect.right - rect.left);
    rect.height = Math.max(0, rect.bottom - rect.top);

    if (rect.width < 8 || rect.height < 2) return null;
    if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) return null;
    return rect;
  }

  function rectsOverlapHorizontally(a, b) {
    return a.right > b.left && a.left < b.right;
  }

  function isVisibleCell(el) {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 12 && rect.height > 12 && style.display !== 'none' && style.visibility !== 'hidden';
  }

  function scrollTarget(target, direction) {
    const maxScrollLeft = target.scrollWidth - target.clientWidth;
    const current = target.scrollLeft;
    const remaining = direction > 0 ? maxScrollLeft - current : current;
    const dynamicStep = Math.min(520, Math.max(260, Math.floor(target.clientWidth * 0.72)));

    let next;
    if (remaining <= dynamicStep + SNAP_TO_END_THRESHOLD) {
      next = direction > 0 ? maxScrollLeft : 0;
    } else {
      next = current + direction * dynamicStep;
    }

    target.scrollTo({ left: next, behavior: 'smooth' });
  }

  const observer = new MutationObserver(debounceScan);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });

  window.addEventListener('load', debounceScan, { once: true });
  window.addEventListener('resize', debounceScan, { passive: true });

  scan();
  window.setTimeout(scan, 600);
  window.setTimeout(scan, 1600);
})();
