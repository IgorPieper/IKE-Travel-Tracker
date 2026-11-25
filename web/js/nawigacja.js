/* Move the original buttons, preserving their handlers and active section. */
const navigationLabels = {
  "map-view": ["Mapa", "Map"], "challenges-view": ["Wyzwania", "Challenges"],
  "diary-view": ["Dziennik", "Journal"], "achievements-view": ["Osiągnięcia", "Achievements"],
  "gallery-view": ["Galeria", "Gallery"],
};
const atlasNavigation = (() => {
  const nav = document.querySelector(".atlas-nav");
  const header = document.querySelector(".top-inner");
  const brand = byId("brand-home");
  const buttons = [...nav.querySelectorAll("[data-section]")];
  const primary = document.createElement("div");
  primary.className = "atlas-nav-primary";
  const more = document.createElement("button");
  more.type = "button";
  more.id = "nav-more";
  more.setAttribute("aria-expanded", "false");
  more.setAttribute("aria-controls", "nav-overflow");
  const overflow = document.createElement("div");
  overflow.id = "nav-overflow";
  overflow.className = "atlas-nav-overflow";
  overflow.hidden = true;
  nav.replaceChildren(primary, more, overflow);
  function close(focus = false) {
    overflow.hidden = true;
    more.setAttribute("aria-expanded", "false");
    if (focus) more.focus();
  }
  function sync() {
    const focused = document.activeElement;
    more.textContent = tr("Więcej", "More") + " ▾";
    const candidates = [], extras = [];
    for (const button of buttons) {
      const preference = button.dataset.section === "map-view" ? "top" : layout["nav_" + button.dataset.section] || (button.dataset.section === "gallery-view" ? "more" : "top");
      button.hidden = preference === "hidden";
      if (preference === "hidden") { primary.append(button); continue; }
      if (preference === "more") extras.push(button);
      else { primary.append(button); candidates.push(button); }
    }
    more.hidden = false;
    const gap = parseFloat(getComputedStyle(header).columnGap) || 0;
    const brandStyle = getComputedStyle(brand);
    const desiredBrandWidth = brand.querySelector(".logo").offsetWidth
      + (parseFloat(brandStyle.columnGap) || 0) + brand.querySelector("h1").scrollWidth;
    const available = Math.max(0, header.clientWidth - Math.min(desiredBrandWidth, header.clientWidth - 90) - gap);
    const widths = candidates.map((button) => button.getBoundingClientRect().width);
    const moreWidth = more.getBoundingClientRect().width;
    const total = (count, withMore) => widths.slice(0, count).reduce((sum, width) => sum + width, 0)
      + Math.max(0, count - 1) * 4 + (withMore ? moreWidth + (count ? 4 : 0) : 0);
    let keep = candidates.length;
    if (extras.length || total(keep, false) > available) {
      while (keep > 1 && total(keep, true) > available) --keep;
    }
    const inOverflow = new Set([...extras, ...candidates.slice(keep)]);
    // Maintain the same order in the menu as in the main navigation.
    for (const button of buttons) if (inOverflow.has(button)) overflow.append(button);
    more.hidden = !inOverflow.size;
    if (more.hidden) close();
    const activeInside = [...inOverflow].some((button) => button.hasAttribute("aria-current"));
    more.classList.toggle("has-current-section", activeInside);
    if (focused && buttons.includes(focused) && focused.isConnected) {
      if (inOverflow.has(focused) && overflow.hidden) more.focus({ preventScroll: true });
      else if (!focused.hidden) focused.focus({ preventScroll: true });
    }
  }
  more.addEventListener("click", () => {
    overflow.hidden = !overflow.hidden;
    more.setAttribute("aria-expanded", String(!overflow.hidden));
  });
  overflow.addEventListener("click", (event) => {
    if (event.target.closest("[data-section]")) { close(true); sync(); }
  });
  document.addEventListener("pointerdown", (event) => { if (!nav.contains(event.target)) close(); });
  nav.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !overflow.hidden) { event.preventDefault(); close(true); }
  });
  for (const event of ["atlas-settings-loaded", "atlas-language-change"]) document.addEventListener(event, sync);
  new ResizeObserver(sync).observe(header);
  new MutationObserver(sync).observe(nav, { subtree: true, attributes: true, attributeFilter: ["aria-current"] });
  document.fonts.ready.then(sync);
  sync();
  return { sync };
})();

function renderNavigationSettings(section) {
  const heading = document.createElement("h4");
  heading.className = "settings-subheading";
  heading.textContent = tr("Górny pasek", "Top navigation");
  section.append(heading);
  for (const [id, names] of Object.entries(navigationLabels)) {
    if (id === "map-view") continue;
    const row = document.createElement("label");
    const text = document.createElement("span");
    text.textContent = tr(...names);
    const select = document.createElement("select");
    for (const [value, pl, en] of [["top", "Górny pasek", "Top bar"], ["more", "Więcej", "More"], ["hidden", "Ukryty", "Hidden"]]) {
      select.add(new Option(tr(pl, en), value));
    }
    select.value = layout["nav_" + id] || (id === "gallery-view" ? "more" : "top");
    select.disabled = !ready;
    select.addEventListener("change", () => {
      saveLayout("nav_" + id, select.value);
      atlasNavigation.sync();
    });
    row.append(text, select);
    section.append(row);
  }
}
