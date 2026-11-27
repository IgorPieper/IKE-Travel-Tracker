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
    visited: ["Odwiedzone", "Visited"], planned: ["Zaplanowane", "Planned"],
  };
  const filterGroups = new Map();
  for (const [id, pl, en] of [["presets", "Widoki mapy", "Map views"], ["other", "Wycieczki i pinezki", "Trips and pins"],
    ["dates", "Daty", "Dates"], ["status", "Status miejsc", "Place status"]]) {
    const group = document.createElement("fieldset");group.className = "gallery-filter-group";
    const legend = document.createElement("legend");legend.dataset.en = en;legend.textContent = tr(pl, en);
    const options = document.createElement("div");options.className = "gallery-tag-options";
    group.append(legend, options);byId("diary-filter-options").append(group);filterGroups.set(id, options);
  }
  const dateFilters = {};
  for (const [key, pl, en] of [["from", "Od", "From"], ["until", "Do", "Until"]]) {
    const label = document.createElement("label");label.className = "diary-date-filter";
    const text = document.createElement("span");text.dataset.en = en;text.textContent = tr(pl, en);
    const input = document.createElement("input");input.type = "date";input.max = "9999-12-31";
    label.append(text, input);filterGroups.get("dates").append(label);dateFilters[key] = input;
    input.addEventListener("input", render);
  }
  const undatedLabel = document.createElement("label");undatedLabel.className = "gallery-tag";
  const undated = document.createElement("input");undated.type = "checkbox";undated.checked = true;
  const undatedText = document.createElement("span");undatedText.dataset.en = "Undated";undatedText.textContent = tr("Bez daty", "Undated");
  undatedLabel.append(undated, undatedText);filterGroups.get("dates").append(undatedLabel);undated.addEventListener("change", render);
  const filterInputs = new Map();
  const filterRevisions = new Map();
  let savedFilters = Object.fromEntries(Object.keys(filterLabels).map((key) => [key, "on"]));
  for (const [key, labels] of Object.entries(filterLabels)) {
    const label = document.createElement("label");
    label.className = "gallery-tag" + (key === "planned" ? " is-planned" : "");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = layout["diary_filter_" + key] !== "off";
    input.disabled = !ready;
    const text = document.createElement("span");
    text.textContent = tr(...labels);
    label.append(input, text);
    filterGroups.get(["pins", "trips"].includes(key) ? "other" : ["visited", "planned"].includes(key) ? "status" : "presets").append(label);
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
    if (layout["diary_filter_" + visitType(visit)] === "off") return false;
    if (visit.kategoria === "wycieczka") return true;
    return layout["diary_filter_" + (visit.tryb === "plan" ? "planned" : "visited")] !== "off" && matchesDates(visit);
  }

  function matchesDates(row) {
    const day = cardDate(row);
    if (!day) return undated.checked;
    return (!dateFilters.from.value || day >= dateFilters.from.value) && (!dateFilters.until.value || day <= dateFilters.until.value);
  }

  function tripVisible(trip) {
    if (!visitVisible(trip) || !matchesDates(trip)) return false;
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

  function visitCard(key, visit, compact = false) {
    const card = document.createElement("article");
    card.className = "diary-card" + (visit.tryb === "plan" ? " is-planned" : "");
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
    if (visit.tryb === "plan") appendText(card, "span", tr("Zaplanowane", "Planned"), "diary-planned-label");
    appendPlaceReading(card, visit);
    appendCountry(card, visit);
    const date = appendText(card, "p", tripDateLabel(visit), "diary-date");
    if (visit.ocena !== "" && visit.ocena != null) {
      const rating = String(visit.ocena);
      appendText(date, "span", " · " + tr(rating.replace(".", ","), rating) + " / 10");
    }
    const note = visit.kategoria === "pinezka" ? visit.opis_dlugi : visit.notatka;
    if (!compact && note) appendText(card, "p", note, "diary-note");
    if (!compact) photoGallery(card, visit.zdjecia);
    if (!draft) addVisitActions(card,key,visit);
    return card;
  }

  const editorDialog = byId("diary-place-editor");
  let mountedEditor;
  function restoreEditor() {
    if (!mountedEditor) return;
    const { panel, anchor, observer, statusObserver, key: visitKey } = mountedEditor;
    mountedEditor = undefined;
    observer.disconnect();statusObserver.disconnect();
    anchor.replaceWith(panel);
    if (editorDialog.open) editorDialog.close();
    if (!view.hidden) [...grid.querySelectorAll("[data-edit-diary-visit]")]
      .find((button) => button.dataset.editDiaryVisit === visitKey)?.focus({preventScroll:true});
  }
  async function closeVisitEditor() {
    if (await closePlaceDetails() && await closePinEditor()) restoreEditor();
  }
  byId("diary-close-place-editor").addEventListener("click", closeVisitEditor);
  editorDialog.addEventListener("cancel", (event) => {event.preventDefault();closeVisitEditor();});
  editorDialog.addEventListener("click", (event) => {
    if (event.target !== editorDialog) return;
    const box = editorDialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeVisitEditor();
  });
  function diaryPlace(visit) {
    const known = visit.kategoria === "panstwo" ? places.panstwo.find(p => p.id === visit.id)
      : visit.kategoria === "kontynent" ? continentsById.get(visit.id)
      : visit.kategoria === "rejon" ? adminRegions.get(visit.id)
      : capitalOutlines.get(visit.id) || capitalRecords.get(visit.id) || majorCities.get(visit.id);
    const position = visit.lon !== "" && visit.lat !== "" && visit.lon != null && visit.lat != null
      ? [Number(visit.lon),Number(visit.lat)] : null;
    return {...known, id:visit.id, category:visit.kategoria, name:known?.name || visit.nazwa,
      country:known?.country || visit.country_code,
      getPosition:position && position.every(Number.isFinite) ? () => position : known?.getPosition};
  }
  function diaryPin(visit) {
    return pinMarkers.find(({pin}) => pin.id === visit.id)?.pin || {...visit,
      position:[Number(visit.lon),Number(visit.lat)],
      kolejne_wizyty:Array.isArray(visit.kolejne_wizyty) ? visit.kolejne_wizyty : JSON.parse(visit.kolejne_wizyty || "[]")};
  }
  async function openVisitEditor(visitKey, visit) {
    if (saving || draft || mountedEditor) return;
    if (!await closePlaceDetails() || !await closePinEditor()) return;
    const isPin = visit.kategoria === "pinezka";
    const panel = byId(isPin ? "pin-details" : "place-details");
    const anchor = document.createComment("Journal editor origin");
    panel.before(anchor);byId("diary-place-editor-body").append(panel);
    try {
      if (isPin) await openPinEditor(diaryPin(visit),true);
      else await openPlace(diaryPlace(visit),{fromJournal:true});
      if (panel.hidden) {anchor.replaceWith(panel);return;}
      const observer = new MutationObserver(() => {if (panel.hidden) restoreEditor();});
      observer.observe(panel,{attributes:true,attributeFilter:["hidden"]});
      const message = byId("diary-place-editor-status");message.textContent = "";
      const statusObserver = new MutationObserver(() => {message.textContent = byId("status").textContent;});
      statusObserver.observe(byId("status"),{childList:true,characterData:true,subtree:true});
      mountedEditor = {panel,anchor,observer,statusObserver,key:visitKey};
      editorDialog.setAttribute("aria-labelledby",isPin ? "pin-details-title" : "place-details-title");
      editorDialog.showModal();
      const repeatId = visitKey.includes(":visit:") ? visitKey.split(":visit:").at(-1) : null;
      const input = repeatId ? [...panel.querySelectorAll("[data-visit-id]")].find(el => el.dataset.visitId === repeatId)
        : byId(isPin ? "pin-date" : "place-date");
      input?.focus();
      input?.closest(".place-return-visit")?.classList.add("diary-current-visit");
    } catch {
      if (mountedEditor) restoreEditor();else anchor.replaceWith(panel);
      status.textContent = tr("Nie udało się otworzyć miejsca.", "Could not open the place.");
    }
  }
  async function removeVisit(visit) {
    if (saving) return;
    const row = visit.kategoria === "pinezka" ? diaryPin(visit) : savedPlaces.get(visit.kategoria+":"+visit.id);
    const additional = Array.isArray(row?.kolejne_wizyty) ? row.kolejne_wizyty : JSON.parse(row?.kolejne_wizyty || "[]");
    const count = 1+additional.length;
    if (count > 1 && !window.confirm(tr(
      `${placeName(visit)} — liczba zapisanych wizyt: ${count}. Czy usunąć je wszystkie?`,
      `${placeName(visit)} has ${count} saved visits. Delete them all?`))) return;
    saving = true;let success = false;
    try {
      if (!await closePlaceDetails() || !await closePinEditor()) return;
      if (visit.kategoria === "pinezka") success = await saveCustomPin({usun:true},{pin:row});
      else {
        const pending = visitQueue.then(() => saveVisit(diaryPlace(visit),{odwiedzone:false}));
        visitQueue = pending.catch(() => false);success = await pending;
      }
      if (!success) throw new Error();
    } catch {status.textContent = tr("Nie udało się usunąć miejsca.", "Could not remove the place.");}
    finally {saving = false;if (success) await load();}
  }
  function addVisitActions(card, visitKey, visit) {
    const open = document.createElement("button");open.type = "button";open.className = "diary-open-place";
    open.dataset.editDiaryVisit = visitKey;
    open.setAttribute("aria-label",tr("Edytuj miejsce: ","Edit place: ")+placeName(visit));
    open.addEventListener("click",(event) => {event.stopPropagation();openVisitEditor(visitKey,visit);});
    const remove = document.createElement("button");remove.type = "button";remove.className = "gallery-delete diary-delete";
    remove.textContent = "×";remove.title = tr("Usuń miejsce", "Remove place");
    remove.setAttribute("aria-label",tr("Usuń miejsce: ","Remove place: ")+placeName(visit));
    remove.disabled = saving;
    remove.addEventListener("click",(event) => {event.stopPropagation();removeVisit(visit);});
    card.classList.add("is-editable");card.append(open,remove);
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
      list.className = "diary-members diary-trip-places";
      for (const visit of members) {
        const visitKey = trip.miejsca.find(key => visits[key] === visit);
        const item = document.createElement("li");item.append(visitCard(visitKey,visit,true));list.append(item);
      }
      card.append(list);
    } else appendText(card, "p", tr("Brak zapisanych wizyt w tej wycieczce.", "No saved visits in this trip."), "diary-date");
    card.addEventListener("click",(event) => {
      if (!event.target.closest("button, input, textarea, label, .diary-trip-places")) openForm(trip);
    });
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
          : tr("Oznacz miejsca jako odwiedzone lub zaplanowane, aby zapełnić dziennik.", "Mark places as visited or planned to start your journal."));
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
