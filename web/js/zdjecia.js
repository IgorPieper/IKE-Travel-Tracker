/* Photo files live locally; progress CSV contains only stable IDs and captions. */
function photoRefs(value) {
  try {
    const refs = typeof value === "string" ? JSON.parse(value || "[]") : value || [];
    return Array.isArray(refs) ? refs.filter((p) => /^[a-f0-9]{64}$/.test(p.id)).map((p) => ({ id: p.id, caption: p.caption || "" })) : [];
  } catch { return []; }
}

function photoGallery(container, value) {
  const refs = photoRefs(value);
  if (!refs.length) return;
  const gallery = document.createElement("div");
  gallery.className = "photo-gallery";
  for (const photo of refs) {
    const figure = document.createElement("figure");
    const image = document.createElement("img");
    image.src = "/photos/" + photo.id + ".jpg?thumbnail=1";
    image.alt = photo.caption || tr("Zdjęcie z podróży", "Travel photo");
    image.loading = "lazy";
    image.decoding = "async";
    figure.append(image);
    if (photo.caption) {
      const caption = document.createElement("figcaption");
      caption.textContent = photo.caption;
      figure.append(caption);
    }
    gallery.append(figure);
  }
  container.append(gallery);
}

const photoPickerEvents = new WeakMap();

function photoPicker(container, owner, value, multiple = false) {
  photoPickerEvents.get(container)?.abort();
  const events = new AbortController();
  photoPickerEvents.set(container, events);
  owner.photos = photoRefs(value);
  const list = document.createElement("div");
  list.className = "photo-picker-list";
  const label = document.createElement("label");
  label.className = "photo-upload";
  const text = document.createElement("span");
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/jpeg,image/png,image/webp,image/avif,image/bmp,image/tiff";
  input.multiple = multiple;
  label.append(text, input);
  const status = document.createElement("p");
  status.className = "photo-upload-status";
  status.setAttribute("role", "status");
  container.replaceChildren(list, label, status);
  let editing = false;
  function setEditing(active, focus = false) {
    editing = active;
    const hasPhoto = !multiple && owner.photos.length > 0;
    container.classList.toggle("photo-picker-editing", hasPhoto && editing);
    label.hidden = hasPhoto && !editing;
    const preview = list.querySelector(".photo-edit-preview");
    if (preview) preview.hidden = editing;
    const remove = list.querySelector(".photo-remove");
    if (remove && !multiple) remove.hidden = !editing;
    const cancel = list.querySelector(".photo-cancel");
    if (cancel) cancel.hidden = !editing;
    if (focus) (editing ? input : preview)?.focus({ preventScroll: true });
  }
  document.addEventListener("pointerdown", (event) => {
    if (!container.contains(event.target)) setEditing(false);
  }, { signal: events.signal });
  container.addEventListener("keydown", (event) => {
    if (!multiple && editing && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setEditing(false, true);
    }
  }, { signal: events.signal });
  input.addEventListener("cancel", () => setEditing(false, true));
  function render() {
    list.replaceChildren();
    text.textContent = multiple ? tr("Dodaj zdjęcia", "Add photos") : owner.photos.length ? tr("Zmień zdjęcie", "Replace photo") : tr("Dodaj zdjęcie", "Add photo");
    for (const photo of owner.photos) {
      const item = document.createElement("div");
      item.className = "photo-picker-item";
      if (multiple) photoGallery(item, [{ ...photo, caption: "" }]);
      else {
        const preview = document.createElement("button");
        preview.type = "button";
        preview.className = "photo-edit-preview";
        preview.setAttribute("aria-label", tr("Edytuj zdjęcie", "Edit photo"));
        photoGallery(preview, [{ ...photo, caption: "" }]);
        preview.addEventListener("click", () => setEditing(true, true));
        item.append(preview);
      }
      if (multiple) {
        const caption = document.createElement("input");
        caption.type = "text";
        caption.maxLength = 500;
        caption.value = photo.caption;
        caption.placeholder = tr("Podpis zdjęcia", "Photo caption");
        caption.setAttribute("aria-label", caption.placeholder);
        caption.addEventListener("input", () => { photo.caption = caption.value; });
        item.append(caption);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "photo-remove";
      remove.textContent = tr("Usuń zdjęcie", "Remove photo");
      remove.addEventListener("click", () => {
        owner.photos = owner.photos.filter((p) => p !== photo);
        render();
      });
      item.append(remove);
      if (!multiple) {
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "photo-remove photo-cancel";
        cancel.textContent = tr("Anuluj", "Cancel");
        cancel.addEventListener("click", () => setEditing(false, true));
        item.append(cancel);
      }
      list.append(item);
    }
    // In a single-photo editor, the image itself opens the temporary controls.
    setEditing(false);
    container.dispatchEvent(new Event("atlas-photo-change", { bubbles: true }));
  }
  input.addEventListener("change", () => {
    const files = [...input.files];
    if (!files.length) return;
    input.disabled = true;
    owner.photoUploading = true;
    container.dispatchEvent(new Event("atlas-photo-change", { bubbles: true }));
    owner.photoUpload = (async () => {
      status.textContent = tr("Zapisywanie zdjęć…", "Saving photos…");
      try {
        if (multiple && owner.photos.length + files.length > 100) throw new Error(tr("Maksymalnie 100 zdjęć na wycieczkę.", "Up to 100 photos per trip."));
        for (const file of files) {
          if (file.size > 25 * 1024 * 1024) throw new Error(tr("Zdjęcie może mieć maksymalnie 25 MB.", "Each photo can be up to 25 MB."));
          const data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(",")[1]);
            reader.onerror = () => reject(new Error(tr("Nie udało się odczytać zdjęcia.", "Could not read the photo.")));
            reader.readAsDataURL(file);
          });
          const response = await fetch("/api/zdjecia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data, name: file.name }) });
          if (!response.ok) throw new Error(tr("Nie udało się zapisać zdjęcia. Wybierz inny obraz.", "Could not save the photo. Choose another image."));
          const photo = await response.json();
          const ref = { id: photo.id, caption: "" };
          if (!multiple) owner.photos = [ref];
          else if (!owner.photos.some((p) => p.id === ref.id)) owner.photos.push(ref);
        }
        status.textContent = "";
      } catch (error) {
        status.textContent = error.message;
      } finally {
        owner.photoUploading = false;
        input.disabled = false;
        input.value = "";
        render();
      }
    })();
  });
  render();
}
