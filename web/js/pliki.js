"use strict";

async function readCsv(path, target) {
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(response.statusText);
    const content = await response.text();
    if (target.textContent !== content) target.textContent = content;
    if (path === "/ustawienia.csv") {
      const language = content.match(/^language,,,,(en|pl)\r?$/m)?.[1] || "pl";
      if (language !== document.documentElement.lang) translatePage(language);
    }
  } catch {
    target.textContent = tr("Nie udało się odczytać pliku. Ponawiam próbę…", "Could not read the file. Retrying…");
  }
}

async function refreshFiles() {
  await Promise.all([
    readCsv("/ustawienia.csv", document.getElementById("settings-csv")),
    readCsv("/odwiedzone.csv", document.getElementById("visits-csv")),
    readCsv("/osiagniecia.csv", document.getElementById("achievements-csv")),
  ]);
  setTimeout(refreshFiles, 750);
}

refreshFiles();
