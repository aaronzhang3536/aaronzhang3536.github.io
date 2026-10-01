// Keep the article outline beside the reading column and track the current section.
const reader = document.querySelector('.reader-with-toc');
const toc = reader?.querySelector('.toc');

if (reader && toc) {
  const disclosure = toc.querySelector('details');
  const list = toc.querySelector('.toc-links');
  const header = document.querySelector('.studio-header');
  const desktop = window.matchMedia('(min-width: 1000px)');
  const sections = Array.from(toc.querySelectorAll('a[href^="#"]')).map((link) => ({
    link,
    heading: document.getElementById(decodeURIComponent(link.hash.slice(1))),
  })).filter(({ heading }) => heading);
  let current = null;
  let scheduled = false;
  let anchorOffset = 88;

  function revealLink(link) {
    if (!disclosure.open) return;
    const bounds = list.getBoundingClientRect();
    const target = link.getBoundingClientRect();
    // Scroll only the outline, never the article or the entire page.
    if (target.top < bounds.top + 8) {
      list.scrollTop -= bounds.top + 8 - target.top;
    } else if (target.bottom > bounds.bottom - 8) {
      list.scrollTop += target.bottom - bounds.bottom + 8;
    }
  }

  function updateCurrentSection() {
    scheduled = false;
    if (desktop.matches && disclosure.open) {
      const top = Math.max(24, list.getBoundingClientRect().top);
      list.style.maxHeight = `${Math.max(140, window.innerHeight - top - 24)}px`;
    } else {
      list.style.removeProperty('max-height');
    }
    let active = sections[0];
    for (const section of sections) {
      if (section.heading.getBoundingClientRect().top > anchorOffset + 2) break;
      active = section;
    }
    if (!active || active === current) return;
    current?.link.removeAttribute('aria-current');
    active.link.setAttribute('aria-current', 'location');
    current = active;
    // Keyboard navigation must not have its focused link scrolled away.
    if (!toc.contains(document.activeElement)) revealLink(active.link);
  }

  function scheduleUpdate() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(updateCurrentSection);
  }

  function updateOffset() {
    const fixedHeader = header && ['fixed', 'sticky'].includes(getComputedStyle(header).position);
    anchorOffset = (fixedHeader ? Math.ceil(header.getBoundingClientRect().height) : 0) + 24;
    reader.style.setProperty('--reader-anchor-offset', `${anchorOffset}px`);
    scheduleUpdate();
  }

  function updateLayout() {
    disclosure.open = desktop.matches;
    updateOffset();
  }

  for (const { link, heading } of sections) {
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (!desktop.matches) disclosure.open = false;
      if (location.hash !== link.hash) history.pushState(null, '', link.hash);
      // Closing the mobile outline changes document height; measure after it closes.
      requestAnimationFrame(() => {
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
        heading.scrollIntoView({ behavior: 'auto', block: 'start' });
        scheduleUpdate();
      });
    });
  }

  disclosure.addEventListener('toggle', () => {
    if (disclosure.open && current) revealLink(current.link);
    scheduleUpdate();
  });
  desktop.addEventListener('change', updateLayout);
  window.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', updateOffset);
  window.addEventListener('hashchange', scheduleUpdate);
  window.addEventListener('pageshow', scheduleUpdate);
  window.addEventListener('load', scheduleUpdate);
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(updateOffset);
    if (header) observer.observe(header);
  }
  updateLayout();
}
