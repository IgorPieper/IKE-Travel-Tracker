"use strict";

function galleryMatchesTags(photo, selectedTags) {
  return !selectedTags.size || (photo.tags || []).some((tag) => selectedTags.has(tag.id));
}

(() => {
  const view = byId("gallery-view"), grid = byId("gallery-grid"), status = byId("gallery-status");
  const dialog = byId("gallery-detail"), form = byId("gallery-edit-form"), undo = byId("gallery-undo");
  let data = { photos: [], deleted: null }, selected, busy = false, sequence = 0;
  let manualTags = [];
  let tagQueue = Promise.resolve(), tagRevision = 0;
  let linkedTripFilter = null;
  const selectedTags = new Set();
  const labels = { wycieczka: ["Wycieczka", "Trip"], pinezka: ["Pinezka", "Pin"],
    kontynent: ["Kontynent", "Continent"], panstwo: ["Państwo", "Country"], rejon: ["Rejon", "Region"], miasto: ["Miejscowość", "Locality"] };
  const title = (photo) => photo.title || photo.uses[0]?.name || tr("Zdjęcie", "Photo");
  const tagName = (tag) => tag.name || tr("Wycieczka", "Trip");
  function tagChip(tag) {
    const chip = document.createElement("span");
    chip.className = "gallery-tag" + (tag.kind === "trip" ? " is-trip" : "");
    chip.textContent = tagName(tag);
    if (tag.kind === "trip") chip.title = tr("Tag wycieczki — przypisywany automatycznie.", "Trip tag — assigned automatically.");
    return chip;
  }
  function renderTagFilters() {
    const container = byId("gallery-tag-options");
    const focusedTag = document.activeElement?.dataset.galleryTag;
    const available = new Map();
    for (const photo of data.photos) for (const tag of photo.tags || []) {
      const record = available.get(tag.id) || { ...tag, count: 0 };
      record.count++;
      available.set(tag.id, record);
    }
    for (const id of selectedTags) if (!available.has(id) && id !== linkedTripFilter) selectedTags.delete(id);
    container.replaceChildren();
    const groups = new Map();
    for (const [kind, pl, en] of [["trip", "Tagi wycieczek", "Trip tags"], ["manual", "Tagi własne", "Custom tags"]]) {
      const group = document.createElement("fieldset");
      group.className = "gallery-filter-group";
      const legend = document.createElement("legend");
      legend.textContent = tr(pl, en);
      const options = document.createElement("div");
      options.className = "gallery-tag-options";
      group.append(legend, options);
      container.append(group);
      groups.set(kind, options);
    }
    for (const tag of [...available.values()].sort((a, b) => (a.kind !== "trip") - (b.kind !== "trip") || tagName(a).localeCompare(tagName(b)))) {
      const label = document.createElement("label");
      label.className = "gallery-tag" + (tag.kind === "trip" ? " is-trip" : "");
      label.title = tag.kind === "trip" ? tr("Tag wycieczki", "Trip tag") : tr("Własny tag", "Custom tag");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.galleryTag = tag.id;
      input.checked = selectedTags.has(tag.id);
      const text = document.createElement("span");
      text.textContent = tagName(tag);
      const count = document.createElement("small");
      count.textContent = tag.count;
      label.append(input, text, count);
      input.addEventListener("change", () => {
        if (input.checked) selectedTags.add(tag.id);
        else selectedTags.delete(tag.id);
        render();
      });
      groups.get(tag.kind).append(label);
      if (focusedTag === tag.id) input.focus({ preventScroll: true });
    }
    for (const [kind, options] of groups) if (!options.childElementCount) {
      const empty = document.createElement("p");
      empty.className = "gallery-no-tags";
      empty.textContent = kind === "trip" ? tr("Brak tagów wycieczek.", "No trip tags yet.")
        : tr("Brak własnych tagów. Dodaj je w szczegółach zdjęcia.", "No custom tags yet. Add them in photo details.");
      options.append(empty);
    }
    byId("gallery-all-tags").disabled = !selectedTags.size;
  }
  function renderPhotoTags() {
    const container = byId("gallery-photo-tags");
    container.replaceChildren();
    for (const tag of selected.tags || []) if (tag.kind === "trip") container.append(tagChip(tag));
    for (const [index, name] of manualTags.entries()) {
      const chip = tagChip({ name, kind: "manual" });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "gallery-remove-tag";
      remove.textContent = "×";
      remove.setAttribute("aria-label", tr("Usuń tag: ", "Remove tag: ") + name);
      remove.addEventListener("click", () => { manualTags.splice(index, 1); renderPhotoTags(); savePhotoTags(); });
      chip.append(remove);
      container.append(chip);
    }
  }
  function addTag() {
    const input = byId("gallery-new-tag");
    const name = input.value.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (!name) { input.focus(); return; }
    const duplicate = manualTags.some((tag) => tag.localeCompare(name, undefined, { sensitivity: "accent" }) === 0);
    const message = byId("gallery-tag-status");
    message.textContent = "";
    if (name.length > 60 || /\p{C}/u.test(name) || manualTags.length >= 50) {
      message.textContent = tr("Maksymalnie 50 tagów, po 60 znaków.", "Up to 50 tags, 60 characters each.");
      return;
    }
    if (!duplicate) manualTags.push(name);
    input.value = "";
    renderPhotoTags();
    if (!duplicate) savePhotoTags();
    input.focus();
  }
  function savePhotoTags() {
    const id = selected.id, tags = [...manualTags], revision = ++tagRevision;
    ++sequence;
    const optimistic = { ...selected, manualTags: tags, tags: [
      ...(selected.tags || []).filter((tag) => tag.kind === "trip"),
      ...tags.map((name) => ({ id: "manual:" + name.toLowerCase(), name, kind: "manual" })),
    ] };
    selected = optimistic;
    data.photos = data.photos.map((photo) => photo.id === id ? optimistic : photo);
    render();
    byId("gallery-tag-status").textContent = tr("Zapisywanie tagów…", "Saving tags…");
    tagQueue = tagQueue.then(async () => {
      try {
        const response = await request("/api/galeria", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, action: "tags", tags }) });
        visitUpdates?.postMessage("photos");
        if (revision !== tagRevision) return;
        data = response;
        if (selected?.id === id) {
          selected = data.photos.find((photo) => photo.id === id) || selected;
          manualTags = [...selected.manualTags];
          renderPhotoTags();
          byId("gallery-tag-status").textContent = "";
        }
        render();
      } catch {
        if (revision !== tagRevision) return;
        const message = tr("Nie udało się zapisać tagów. Spróbuj ponownie.", "Could not save tags. Please try again.");
        byId("gallery-tag-status").textContent = status.textContent = message;
        try {
          data = await request("/api/galeria");
          if (selected?.id === id) {
            selected = data.photos.find((photo) => photo.id === id) || selected;
            manualTags = [...selected.manualTags];
            renderPhotoTags();
          }
          render();
        } catch { /* Keep the editor open and its error visible. */ }
      }
    });
    return tagQueue;
  }
  function render() {
    grid.replaceChildren();
    renderTagFilters();
    const visiblePhotos = data.photos.filter((photo) => galleryMatchesTags(photo, selectedTags));
    byId("gallery-count").textContent = tr("Zdjęcia: ", "Photos: ") + (selectedTags.size
      ? tr(`${visiblePhotos.length} z ${data.photos.length}`, `${visiblePhotos.length} of ${data.photos.length}`) : String(data.photos.length));
    undo.hidden = !data.deleted;
    undo.disabled = busy;
    if (!visiblePhotos.length) {
      const empty = document.createElement("p");
      empty.className = "gallery-empty";
      empty.textContent = data.photos.length ? tr("Brak zdjęć z wybranymi tagami.", "No photos match the selected tags.")
        : tr("Dodaj zdjęcia do miejsc lub wycieczek, aby zobaczyć je w galerii.", "Add photos to places or trips to see them in your gallery.");
      grid.append(empty);
    }
    for (const photo of visiblePhotos) {
      const card = document.createElement("article");
      card.className = "gallery-card";
      const preview = document.createElement("button");
      preview.type = "button";
      preview.className = "gallery-preview";
      preview.setAttribute("aria-label", tr("Szczegóły zdjęcia: ", "Photo details: ") + title(photo));
      const image = document.createElement("img");
      image.src = "/photos/" + photo.id + ".jpg?thumbnail=1";
      image.alt = photo.description || title(photo);
      image.loading = "lazy";
      image.decoding = "async";
      preview.append(image);
      preview.addEventListener("click", () => open(photo));
      const caption = document.createElement("div");
      caption.className = "gallery-card-caption";
      const heading = document.createElement("h3");
      heading.textContent = title(photo);
      caption.append(heading);
      const tags = document.createElement("div");
      tags.className = "gallery-card-tags";
      for (const tag of photo.tags || []) tags.append(tagChip(tag));
      caption.append(tags);
      if (photo.description) {
        const description = document.createElement("p");
        description.textContent = photo.description;
        caption.append(description);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "gallery-delete";
      remove.textContent = "×";
      remove.setAttribute("aria-label", tr("Usuń zdjęcie: ", "Delete photo: ") + title(photo));
      remove.title = tr("Usuń zdjęcie", "Delete photo");
      remove.disabled = busy;
      remove.addEventListener("click", () => mutate({ id: photo.id, action: "delete" }));
      card.append(preview, caption, remove);
      grid.append(card);
    }
  }
  function open(photo) {
    selected = photo;
    manualTags = [...(photo.manualTags || [])];
    byId("gallery-new-tag").value = "";
    byId("gallery-tag-status").textContent = "";
    renderPhotoTags();
    byId("gallery-detail-title").textContent = title(photo);
    byId("gallery-detail-image").src = "/photos/" + photo.id + ".jpg";
    byId("gallery-detail-image").alt = photo.description || title(photo);
    byId("gallery-description").value = photo.description;
    byId("gallery-photo-title").value = photo.title;
    byId("gallery-photo-date").value = photo.taken;
    byId("gallery-photo-size").textContent = `${(photo.bytes / 1024).toFixed(1)} KB · ${photo.width} × ${photo.height} px`;
    byId("gallery-metadata").hidden = true;
    byId("gallery-more-info").setAttribute("aria-expanded", "false");
    byId("gallery-more-info").textContent = tr("Więcej informacji", "More information");
    byId("gallery-detail-status").textContent = "";
    const list = byId("gallery-uses");
    list.replaceChildren();
    for (const use of photo.uses) {
      const item = document.createElement("li");
      item.textContent = tr(...(labels[use.category] || ["Miejsce", "Place"])) + " · " + use.name;
      list.append(item);
    }
    if (!photo.uses.length) {
      const item = document.createElement("li");
      item.textContent = tr("Nie jest obecnie używane.", "Not currently used.");
      list.append(item);
    }
    dialog.showModal();
  }
  async function load() {
    if (view.hidden || busy) return;
    const current = ++sequence;
    try {
      await closePlaceDetails(); await closePinEditor(); await visitQueue; await tagQueue;
      const response = await request("/api/galeria");
      if (current !== sequence) return;
      data = response;
      if (dialog.open && selected) {
        const currentPhoto = data.photos.find((photo) => photo.id === selected.id);
        if (currentPhoto) {
          selected = currentPhoto;
          manualTags = [...selected.manualTags];
          renderPhotoTags();
        }
      }
      status.textContent = "";
      render();
    } catch { status.textContent = tr("Nie udało się wczytać zdjęć.", "Could not load photos."); }
  }
  async function mutate(change) {
    if (busy) return;
    busy = true;
    ++sequence;
    status.textContent = "";
    for (const button of form.querySelectorAll("button")) button.disabled = true;
    render();
    try {
      await tagQueue;
      data = await request("/api/galeria", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) });
      if (dialog.open) dialog.close();
      const [places, pins] = await Promise.all([request("/api/odwiedzone"), request("/api/pinezki")]);
      readMarked(places); renderCustomPins(pins);
      document.dispatchEvent(new Event("atlas-visits-change"));
      document.dispatchEvent(new Event("atlas-pins-change"));
      visitUpdates?.postMessage("photos");
      status.textContent = change.action === "delete" ? tr("Zdjęcie usunięte. Możesz cofnąć usunięcie.", "Photo deleted. You can undo the deletion.")
        : change.action === "restore" ? tr("Zdjęcie przywrócone.", "Photo restored.") : tr("Zapisano.", "Saved.");
    } catch {
      const message = tr("Nie udało się zapisać zmiany. Spróbuj ponownie.", "Could not save the change. Please try again.");
      status.textContent = byId("gallery-detail-status").textContent = message;
    } finally {
      busy = false;
      for (const button of form.querySelectorAll("button")) button.disabled = false;
      render();
    }
  }
  byId("gallery-more-info").addEventListener("click", () => {
    const metadata = byId("gallery-metadata");
    metadata.hidden = !metadata.hidden;
    byId("gallery-more-info").setAttribute("aria-expanded", String(!metadata.hidden));
    byId("gallery-more-info").textContent = metadata.hidden ? tr("Więcej informacji", "More information") : tr("Mniej informacji", "Less Information");
  });
  for (const id of ["gallery-close", "gallery-cancel"]) byId(id).addEventListener("click", () => { if (!busy) dialog.close(); });
  dialog.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const photoId = selected?.id;
    if (byId("gallery-new-tag").value.trim()) {
      addTag();
      if (byId("gallery-new-tag").value.trim()) return;
    }
    await tagQueue;
    if (selected?.id !== photoId || !dialog.open) return;
    if (selected) mutate({ id: selected.id, action: "update", title: byId("gallery-photo-title").value,
      taken: byId("gallery-photo-date").value, description: byId("gallery-description").value, tags: manualTags });
  });
  byId("gallery-add-tag").addEventListener("click", addTag);
  byId("gallery-new-tag").addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); addTag(); }
  });
  byId("gallery-all-tags").addEventListener("click", () => { linkedTripFilter = null; selectedTags.clear(); render(); });
  undo.addEventListener("click", () => { if (data.deleted) mutate({ id: data.deleted, action: "restore" }); });
  document.querySelector('[data-section="gallery-view"]').addEventListener("click", load);
  document.addEventListener("atlas-open-gallery", async ({ detail }) => {
    selectedTags.clear();
    linkedTripFilter = "trip:" + detail.tripId;
    selectedTags.add(linkedTripFilter);
    byId("gallery-tag-filters").open = true;
    showSection("gallery-view");
    await load();
    view.scrollIntoView({ block: "start" });
  });
  for (const event of ["atlas-journal-change", "atlas-visits-change", "atlas-pins-change"]) document.addEventListener(event, load);
  document.addEventListener("atlas-language-change", () => { if (!view.hidden) render(); });
  visitUpdates?.addEventListener("message", load);
})();
