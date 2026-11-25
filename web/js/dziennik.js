"use strict";

function diaryTripPhotos(trip, visits) {
  const photos = new Map();
  for (const row of [trip, ...trip.miejsca.map((key) => visits[key]).filter(Boolean)]) {
    for (const photo of photoRefs(row.zdjecia)) if (!photos.has(photo.id)) photos.set(photo.id, photo);
  }
  return [...photos.values()];
}

(() => {
  const view = byId("diary-view");
  const grid = byId("diary-cards");
  const status = byId("diary-status");
  const selectionStatus = byId("diary-selection-status");
  const newTrip = byId("diary-new-trip");
  const form = byId("diary-trip-form");
  const name = byId("diary-trip-name");
  const start = byId("diary-start");
  const end = byId("diary-end");
  const startUncertain = byId("diary-start-uncertain");
  const endUncertain = byId("diary-end-uncertain");
  bindUncertainDate(start, startUncertain, byId("diary-start-approx"));
  bindUncertainDate(end, endUncertain, byId("diary-end-approx"));
  const notes = byId("diary-notes");
  const save = byId("diary-save");
  const ungroup = byId("diary-ungroup");
  const endpoint = "/api/dziennik";
  let visits = {};
  let trips = [];
  let draft;
  let saving = false;
  let loadNumber = 0;
  const collapsedYears = new Set();
  const filterLabels = {
    continents: ["Kontynenty", "Continents"], countries: ["Państwa", "Countries"], regions: ["Rejony", "Regions"],
    subregions: ["Podregiony", "Subregions"],
    major: ["Duże miasta", "Major cities"], cities: ["Pozostałe miasta", "Other cities"], villages: ["Wsie", "Villages"],
    pins: ["Pinezki", "Pins"], trips: ["Wycieczki", "Trips"],
  };
  const filterInputs = new Map();
  const filterRevisions = new Map();
  let savedFilters = Object.fromEntries(Object.keys(filterLabels).map((key) => [key, "on"]));
  for (const [key, labels] of Object.entries(filterLabels)) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = layout["diary_filter_" + key] !== "off";
    input.disabled = !ready;
    const text = document.createElement("span");
    text.textContent = tr(...labels);
    label.append(input, text);
    byId("diary-filter-options").append(label);
    filterInputs.set(key, { input, text });
    input.addEventListener("change", () => saveFilters({ [key]: input.checked ? "on" : "off" }));
  }

  function syncFilters() {
    for (const [key, { input, text }] of filterInputs) {
      input.checked = layout["diary_filter_" + key] !== "off";
      input.disabled = !ready;
      text.textContent = tr(...filterLabels[key]);
    }
    syncMainSettings();
  }

  function saveFilters(updated) {
    const changes = {};
    for (const [key, value] of Object.entries(updated)) {
      layout["diary_filter_" + key] = value;
      changes["diary_filter_" + key] = value;
      filterRevisions.set(key, (filterRevisions.get(key) || 0) + 1);
    }
    const revisions = Object.fromEntries(Object.keys(updated).map((key) => [key, filterRevisions.get(key)]));
    status.textContent = "";
    syncFilters();
    if (!view.hidden) render();
    layoutQueue = layoutQueue.then(async () => {
      try {
        const response = await request("/api/ustawienia", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ layout: changes }),
        });
        for (const key of Object.keys(updated)) savedFilters[key] = response.layout["diary_filter_" + key];
      } catch {
        for (const key of Object.keys(updated)) {
          if (revisions[key] === filterRevisions.get(key)) layout["diary_filter_" + key] = savedFilters[key];
        }
        const message = tr("Nie udało się zapisać filtrów.", "Could not save filters.");
        status.textContent = message;
        byId("main-settings-status").textContent = message;
        syncFilters();
        if (!view.hidden) render();
      }
    });
  }

  function visitType(visit) {
    if (visit.kategoria === "rejon" && visit.diary_type === "subregions") return "subregions";
    if (visit.kategoria === "miasto") return visit.diary_type || (visit.id.startsWith("simc:") ? "villages" : isMajorCity(visit.id) ? "major" : "cities");
    return { kontynent: "continents", panstwo: "countries", rejon: "regions", pinezka: "pins", wycieczka: "trips" }[visit.kategoria];
  }

  function visitVisible(visit) {
    return layout["diary_filter_" + visitType(visit)] !== "off";
  }

  function tripVisible(trip) {
    if (!visitVisible(trip)) return false;
    const members = trip.miejsca.map((key) => visits[key]).filter(Boolean);
    return !members.length || members.some(visitVisible);
  }

  function countryName(visit) {
    if (visit.kategoria !== "miasto") return "";
    const country = places.panstwo.find((place) => place.id === visit.panstwo_id);
    if (country) return displayPlaceName(country);
    const code = visit.country_code;
    if (code && /^[A-Z]{2}$/.test(code)) return new Intl.DisplayNames([document.documentElement.lang], { type: "region" }).of(code);
    return tr("Nieznany kraj", "Unknown country");
  }

  function appendCountry(parent, visit) {
    const country = countryName(visit);
    if (country) appendText(parent, "small", country, "diary-country");
  }

  function appendText(parent, tag, text, className) {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    parent.append(element);
    return element;
  }

  function dayLabel(day) {
    const date = new Date(day + "T00:00:00Z");
    if (Number.isNaN(+date)) return day;
    return new Intl.DateTimeFormat(document.documentElement.lang, { dateStyle: "long", timeZone: "UTC" }).format(date);
  }

  function tripDateLabel(trip) {
    const first = trip.data;
    const last = trip.data_konca;
    if (first && last && dateIsUncertain(trip) && dateIsUncertain({ data_niepewna: trip.data_konca_niepewna })) return tr("Bez daty", "Undated");
    const firstLabel = uncertaintyPrefix(first ? dayLabel(first) : "", trip);
    const lastLabel = uncertaintyPrefix(last ? dayLabel(last) : "", { data_niepewna: trip.data_konca_niepewna });
    if (first && last) return firstLabel === lastLabel ? firstLabel : firstLabel + " – " + lastLabel;
    if (first) return tr("Od ", "From ") + firstLabel;
    if (last) return tr("Do ", "Until ") + lastLabel;
    return tr("Bez daty", "Undated");
  }

  function placeName(visit) {
    const country = visit.kategoria === "panstwo" && places.panstwo.find((place) => place.id === visit.id);
    return country ? displayPlaceName(country) : visit.nazwa;
  }

  function cardDate(row) {
    return row.data || (row.kategoria === "wycieczka" ? row.data_konca : "") || "";
  }

  function descendingDates(a, b) {
    return cardDate(b).localeCompare(cardDate(a));
  }

  function dateDrivenSelection() {
    return draft && (draft.startEdited || draft.endEdited);
  }

  function orderCards(entries) {
    if (!dateDrivenSelection() || (!start.value && !end.value)) {
      return entries.sort((a, b) => descendingDates(a[1], b[1]));
    }
    const first = start.value ? Date.parse(start.value) : -Infinity;
    const enteredEnd = end.value ? Date.parse(end.value) : Infinity;
    const last = enteredEnd < first ? Infinity : enteredEnd;
    const hasRange = Number.isFinite(first) && Number.isFinite(last);
    const boundary = Number.isFinite(first) ? first : last;
    return entries.map((entry) => {
      const day = Date.parse(entry[1].data);
      if (!Number.isFinite(day)) return { entry, rank: 2, distance: 0, day: 0 };
      const inside = day >= first && day <= last;
      const distance = hasRange ? Math.max(first - day, day - last, 0) : Math.abs(day - boundary);
      return { entry, rank: inside ? 0 : 1, distance, day };
    }).sort((a, b) => a.rank - b.rank || a.distance - b.distance ||
      (hasRange && a.rank === 0 ? a.day - b.day : b.day - a.day)).map(({ entry }) => entry);
  }

  function claimedVisits(exceptId) {
    return new Set(trips.filter((trip) => trip.id !== exceptId).flatMap((trip) => trip.miejsca));
  }

  function updateSelection() {
    if (!draft) return;
    const count = draft.members.size;
    selectionStatus.textContent = tr(`Wybrane wizyty · ${count}`, `Selected visits · ${count}`)
      + (!draft.existing && count < 1 ? tr(" · wybierz co najmniej jedną wizytę", " · choose at least one visit") : "");
    save.disabled = saving || (!draft.existing && count < 1);
    if (draft.existing) return;
    const dates = [...draft.members].map((key) => visits[key]?.data).filter(Boolean).sort();
    if (!draft.startEdited) start.value = dates[0] || "";
    if (!draft.endEdited) end.value = dates.at(-1) || "";
    start.syncUncertainty(); end.syncUncertainty();
  }

  function visitCard(key, visit) {
    const card = document.createElement("article");
    card.className = "diary-card";
    if (draft) {
      const label = document.createElement("label");
      label.className = "diary-select-visit";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.diaryVisit = key;
      checkbox.checked = draft.members.has(key);
      checkbox.disabled = saving;
      label.append(checkbox);
      appendText(label, "span", placeName(visit));
      card.append(label);
      card.classList.toggle("is-selected", checkbox.checked);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) draft.members.add(key);
        else draft.members.delete(key);
        card.classList.toggle("is-selected", checkbox.checked);
        if (dateDrivenSelection()) render();
        else updateSelection();
      });
    } else {
      appendText(card, "h3", placeName(visit));
    }
    appendPlaceReading(card, visit);
    appendCountry(card, visit);
    const date = appendText(card, "p", tripDateLabel(visit), "diary-date");
    if (visit.ocena !== "" && visit.ocena != null) {
      const rating = String(visit.ocena);
      appendText(date, "span", " · " + tr(rating.replace(".", ","), rating) + " / 10");
    }
    const note = visit.kategoria === "pinezka" ? visit.opis_dlugi : visit.notatka;
    if (note) appendText(card, "p", note, "diary-note");
    photoGallery(card, visit.zdjecia);
    return card;
  }

  function tripCard(trip) {
    const card = document.createElement("article");
    card.className = "diary-card is-trip";
    const header = document.createElement("div");
    header.className = "diary-card-header";
    const title = trip.nazwa || tr("Wycieczka", "Trip");
    appendText(header, "h3", title);
    const edit = appendText(header, "button", tr("Edytuj", "Edit"));
    edit.type = "button";
    edit.setAttribute("aria-label", tr("Edytuj wycieczkę", "Edit trip") + " · " + title);
    edit.addEventListener("click", () => openForm(trip));
    card.append(header);
    appendText(card, "p", tripDateLabel(trip), "diary-date");
    const members = trip.miejsca.map((key) => visits[key]).filter((visit) => visit && visitVisible(visit)).sort(descendingDates);
    if (members.length) {
      const list = document.createElement("ul");
      list.className = "diary-members";
      for (const visit of members) {
        const item = appendText(list, "li", placeName(visit), "diary-member");
        if (visit.data || visit.data_konca) appendText(item, "time", " · " + tripDateLabel(visit)).dateTime = visit.data || visit.data_konca;
        appendPlaceReading(item, visit);
        appendCountry(item, visit);
      }
      card.append(list);
    } else appendText(card, "p", tr("Brak zapisanych wizyt w tej wycieczce.", "No saved visits in this trip."), "diary-date");
    if (trip.notatka) appendText(card, "p", trip.notatka, "diary-note");
    const photos = diaryTripPhotos(trip, visits);
    photoGallery(card, photos.slice(0, 1));
    if (photos.length > 1) {
      const more = appendText(card, "button", tr("Zobacz więcej zdjęć", "View more photos"), "diary-view-more");
      more.type = "button";
      more.setAttribute("aria-label", tr("Zobacz zdjęcia wycieczki: ", "View trip photos: ") + title);
      more.addEventListener("click", () => document.dispatchEvent(new CustomEvent("atlas-open-gallery", { detail: { tripId: trip.id } })));
    }
    return card;
  }

  function render() {
    const focusedVisit = grid.contains(document.activeElement) && document.activeElement.dataset.diaryVisit;
    for (const section of grid.querySelectorAll("details[data-diary-year]")) {
      const year = section.dataset.diaryYear;
      if (section.open) collapsedYears.delete(year);
      else collapsedYears.add(year);
    }
    const claimed = claimedVisits(draft?.id);
    const available = Object.entries(visits).filter(([key, visit]) => !claimed.has(key) && visitVisible(visit));
    newTrip.hidden = Boolean(draft);
    newTrip.disabled = available.length < 1;
    updateSelection();
    const ordered = orderCards([...available, ...(draft ? [] : trips.filter(tripVisible).map((trip) => [trip.id, trip]))]);
    grid.replaceChildren();
    if (draft && ordered.length) {
      const cards = appendText(grid, "div", "", "diary-card-grid");
      for (const [key, row] of ordered) cards.append(visitCard(key, row));
    } else if (ordered.length) {
      const byYear = new Map();
      for (const [key, row] of ordered) {
        const year = cardDate(row).slice(0, 4);
        if (!byYear.has(year)) {
          const section = document.createElement("details");
          section.className = "diary-year";
          section.dataset.diaryYear = year;
          section.open = !collapsedYears.has(year);
          appendText(section, "summary", year || tr("Bez daty", "Undated"));
          byYear.set(year, appendText(section, "div", "", "diary-card-grid"));
          grid.append(section);
        }
        byYear.get(year).append(row.kategoria === "wycieczka" ? tripCard(row) : visitCard(key, row));
      }
    } else {
      appendText(grid, "p", draft ? tr("Brak wizyt do dodania.", "No visits to add.")
        : Object.keys(visits).length || trips.length ? tr("Brak wpisów dla wybranych filtrów.", "No entries match the selected filters.")
          : tr("Dziennik zapełni się, gdy oznaczysz miejsca jako odwiedzone.", "Mark places as visited to start your journal."));
    }
    if (focusedVisit) [...grid.querySelectorAll("[data-diary-visit]")]
      .find((checkbox) => checkbox.dataset.diaryVisit === focusedVisit)?.focus({ preventScroll: true });
  }

  function setData(data) {
    visits = data.visits;
    trips = data.trips;
    if (draft) {
      const claimed = claimedVisits(draft.id);
      draft.members = new Set([...draft.members].filter((key) => Object.hasOwn(visits, key) && !claimed.has(key)));
    }
    render();
  }

  async function load() {
    if (view.hidden || saving) return;
    const sequence = ++loadNumber;
    try {
      const data = await request(endpoint);
      if (sequence !== loadNumber) return;
      status.textContent = "";
      setData(data);
    } catch {
      if (sequence === loadNumber) status.textContent = tr("Nie udało się wczytać dziennika.", "Could not load the journal.");
    }
  }

  function openForm(trip) {
    draft = {
      id: trip?.id || crypto.randomUUID(), existing: Boolean(trip), members: new Set(trip?.miejsca),
      startEdited: Boolean(trip), endEdited: Boolean(trip),
    };
    photoPicker(byId("trip-photos"), draft, trip?.zdjecia, true);
    byId("diary-form-title").textContent = trip ? tr("Edytuj wycieczkę", "Edit trip") : tr("Nowa wycieczka", "New trip");
    name.value = trip?.nazwa || "";
    start.value = trip?.data || "";
    end.value = trip?.data_konca || "";
    startUncertain.checked = dateIsUncertain(trip);
    endUncertain.checked = dateIsUncertain({ data_niepewna: trip?.data_konca_niepewna });
    start.syncUncertainty(); end.syncUncertainty();
    end.setCustomValidity("");
    notes.value = trip?.notatka || "";
    form.hidden = false;
    selectionStatus.hidden = false;
    ungroup.hidden = !trip;
    status.textContent = "";
    render();
    name.focus();
  }

  function closeForm() {
    draft = undefined;
    form.hidden = true;
    selectionStatus.hidden = true;
    render();
  }

  async function commit(change) {
    if (!draft || saving) return;
    saving = true;
    ++loadNumber;
    byId("diary-trip-fields").disabled = true;
    status.textContent = "";
    render();
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: draft.id, ...change }),
      });
      if (response.status === 409) {
        setData(await request(endpoint));
        status.textContent = tr("Lista wizyt się zmieniła. Sprawdź wybór i zapisz ponownie.",
          "The list of visits changed. Check your selection and save again.");
        return;
      }
      if (!response.ok) throw new Error(response.statusText);
      const data = await response.json();
      closeForm();
      setData(data);
      visitUpdates?.postMessage("journal");
      document.dispatchEvent(new Event("atlas-journal-change"));
    } catch {
      status.textContent = tr("Nie udało się zapisać wycieczki.", "Could not save the trip.");
    } finally {
      saving = false;
      byId("diary-trip-fields").disabled = false;
      render();
    }
  }

  newTrip.addEventListener("click", () => openForm());
  byId("diary-show-all").addEventListener("click", () => saveFilters(Object.fromEntries(Object.keys(filterLabels).map((key) => [key, "on"]))));
  document.addEventListener("atlas-settings-loaded", ({ detail: settings }) => {
    savedFilters = Object.fromEntries(Object.keys(filterLabels).map((key) => [key, settings.layout["diary_filter_" + key] || "on"]));
    syncFilters();
  });
  document.addEventListener("atlas-language-change", () => {
    syncFilters();
    if (!view.hidden) render();
  });
  byId("diary-cancel").addEventListener("click", closeForm);
  ungroup.addEventListener("click", () => commit({ usun: true }));
  for (const [field, flag] of [[start, "startEdited"], [end, "endEdited"]]) {
    field.addEventListener("input", () => {
      if (!draft) return;
      draft[flag] = true;
      end.setCustomValidity("");
      render();
    });
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!draft) return;
    const owner = draft;
    await owner.photoUpload;
    if (draft !== owner) return;
    if (start.value && end.value && end.value < start.value) {
      end.setCustomValidity(tr("Data końca nie może być wcześniejsza od początku.", "The end date must be on or after the start date."));
      end.reportValidity();
      return;
    }
    commit({
      nazwa: name.value, data: start.value, data_konca: end.value,
      data_niepewna: startUncertain.checked, data_konca_niepewna: endUncertain.checked,
      notatka: notes.value, miejsca: [...draft.members], zdjecia: draft.photos,
    });
  });
  document.querySelector('[data-section="diary-view"]').addEventListener("click", load);
  document.addEventListener("atlas-visits-change", load);
  document.addEventListener("atlas-pins-change", load);
  visitUpdates?.addEventListener("message", (event) => { if (event.data === "journal" || event.data === "photos") load(); });
})();
