"use strict";

const tr = (pl, en) => document.documentElement.lang === "en" ? en : pl;
const originalText = new WeakMap();
const originalAttributes = new WeakMap();

function translatePage(language) {
  document.documentElement.lang = language === "en" ? "en" : "pl";
  for (const element of document.querySelectorAll("[data-en]")) {
    if (!originalText.has(element)) originalText.set(element, element.textContent);
    element.textContent = tr(originalText.get(element), element.dataset.en);
  }
  for (const element of document.querySelectorAll("[data-en-label], [data-en-title]")) {
    if (!originalAttributes.has(element)) {
      originalAttributes.set(element, { label: element.getAttribute("aria-label"), title: element.title });
    }
    const original = originalAttributes.get(element);
    if (element.dataset.enLabel) element.setAttribute("aria-label", tr(original.label, element.dataset.enLabel));
    if (element.dataset.enTitle) element.title = tr(original.title, element.dataset.enTitle);
  }
}
