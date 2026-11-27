"use strict";

(() => {
  const byId = (id) => document.getElementById(id);
  const catalogues = new Map();
  const loadedCatalogues = new Map();
  const selected = { parks: "", bliza: "", islands: "", hewelion: "", castles: "", seas: "" };
  const catalogueUrls = {
    parks: "/parki-wyzwanie.json", bliza: "/latarnie-wyzwanie.json", islands: "/wyspy-greckie.json",
    hewelion: "/heweliony.json",
    castles: "/polskie-zamki.json",
    seas: "/morza-proste.json",
  };
  let lighthouseQuery = "";
  // The 13 locations in the BLIZA passport, plus Rozewie II added as the 14th in 2022 (NMM).
  const passportLighthouses = [
    "Q2617672", "Q11321434", "Q11309665", "Q11290411", "Q19892304", "Q671310", "Q11301633",
    "Q11320229", "Q10971018", "Q11753144", "Q55517032", "Q6111315", "Q11753140", "Q10969490",
  ];
  // Decorative objects and the Wikidata list of demolished lighthouses.
  const ineligibleForeignLighthouses = new Set(`
    Q1821440 Q1960616 Q1960624
    Q1034493 Q10495401 Q107377542 Q108777495 Q109101361 Q109235124 Q109324551 Q109500347 Q109518898
    Q109519525 Q109526162 Q109753171 Q109828454 Q109828455 Q109850174 Q109850175 Q109851610 Q109858673
    Q109858678 Q109860370 Q109931663 Q110158807 Q110422649 Q110422650 Q110514707 Q110545157 Q110684482
    Q110684483 Q110768836 Q110768837 Q110971042 Q110971216 Q110971217 Q110972095 Q111191113 Q111214451
    Q111302670 Q113828963 Q116467433 Q11753143 Q118139995 Q11880627 Q11988444 Q125545602 Q126487667
    Q133799815 Q14682414 Q14685660 Q14692309 Q14705720 Q14707382 Q14716248 Q15204027 Q15224512 Q15264295
    Q16503269 Q16890306 Q16904108 Q17191876 Q17223341 Q1740187 Q17447912 Q1821410 Q21522650 Q21635815
    Q2334542 Q25162256 Q2609558 Q26161442 Q28339496 Q28374612 Q28375694 Q28933831 Q28966963 Q29949348
    Q30275539 Q32130775 Q32225221 Q32227471 Q32252479 Q32286279 Q32607271 Q33105264 Q33130370 Q33137458
    Q3376557 Q3643727 Q3739811 Q38117925 Q38120029 Q38219457 Q38673957 Q39060433 Q39130556 Q3970355
    Q40781649 Q41708916 Q41709144 Q41709619 Q41798979 Q41810370 Q42175419 Q42313730 Q42313733 Q42313739
    Q42313746 Q42327752 Q42327787 Q43121279 Q43122593 Q43244 Q44814384 Q44833556 Q45023568 Q45025585
    Q4557010 Q45732166 Q45732567 Q45736881 Q45737935 Q4839150 Q4961727 Q4971939 Q4996980 Q5005214
    Q5015818 Q5034789 Q5034856 Q5050226 Q5051037 Q5056834 Q5070995 Q5085983 Q5104887 Q5110434 Q5129928
    Q5150588 Q5179980 Q5180287 Q5182083 Q5188350 Q5212182 Q5221077 Q5250673 Q5253241 Q5347829 Q5353798
    Q5430464 Q5464053 Q5471862 Q5471922 Q5475382 Q55049248 Q5588280 Q5599954 Q5603769 Q5617750 Q5856416
    Q5876980 Q58939138 Q59239252 Q60813977 Q6153088 Q6276887 Q6407880 Q6481286 Q64829659 Q65571714
    Q6652338 Q6673280 Q6692232 Q6693364 Q6758727 Q6787143 Q7060159 Q7124322 Q7142399 Q7207929 Q7207943
    Q7282904 Q7339790 Q7396104 Q7559769 Q790659 Q8960918 Q983738 Q98925433
  `.trim().split(/\s+/));
  const progress = { atrakcja_parku: new Set(), park_narodowy: new Set(), latarnia: new Set(),
    wyspa_grecka: new Set(), cypr: new Set(), hewelion: new Set(), zamek: new Set(), morze: new Set() };
  const pending = new Set();
  const achievementsView = byId("achievements-view");
  const stateCodes = new Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "));
  const goalContinents = ["europe", "asia", "africa", "north-america", "south-america", "oceania"];
  const secretCities = {
    chornobyl: {
      ids: ["1159147523", "overture:054206ab-e448-444a-8ea2-a3427a0828c1"],
      names: ["czarnobyl", "chernobyl", "chornobyl", "чорнобиль", "чернобыль"],
      country: "UA", bounds: [30.15, 51.22, 30.30, 51.32],
    },
    krolewiec: {
      ids: ["1159149527", "overture:6cfb3696-5ed5-443c-89b9-d617ddac9506"],
      names: ["krolewiec", "kaliningrad", "kaliningrad city", "konigsberg", "kionigsberg", "калининград"],
      country: "RU", bounds: [20.35, 54.61, 20.70, 54.83], region: "ne:RUS-2324",
    },
  };
  let achievementDefinitions = [];
  let developerAllAchievements = false;
  let tripCountries;
  let achievementLoad = 0;
  let achievementStatsLoad = 0;
  let achievementStatsTimer;
  const achievementTiersSeen = new Map();
  const collapsedAchievementGroups = new Set();
  const expandedAchievementLists = new Set();
  const achievementToastQueue = [];
  const achievementToastDuration = 6000;
  let visitedChallengeData = false;
  let usStateIds;
  const polandBounds = [[14.05, 48.95], [24.25, 54.95]];
  const polandCountryId = "1159321179";
  const greeceAndCyprusBounds = [[19.2, 34.7], [34.8, 41.9]];
  const gdanskMapBounds = [[18.35, 54.23], [19.13, 54.63]];
  const castleCategories = {
    outstanding: { title: ["Zamki wybitne", "Outstanding castles"], glyph: "★", color: "#9d611b" },
    open: { title: ["Zamki dostępne do zwiedzania", "Castles open to visitors"], glyph: "♜", color: "#276b82" },
    irregular: { title: ["Zamki bez regularnego zwiedzania", "Castles without regular tours"], glyph: "◇", color: "#76509a" },
    ruins: { title: ["Ruiny zamków", "Castle ruins"], glyph: "✕", color: "#736660" },
  };
  const castleVisibility = new Map();
  const cyprusCountryIds = ["1159320531", "1159320533"];
  // Eastern Mediterranean and the Balkans, using the atlas basemap's country IDs.
  const greeceAndNeighbours = [
    "1159320325", "1159320417", "1159320409", "1159320575", "1159320833",
    "1159320895", "1159320899", "1159320919", "1159321007", "1159321013", "1159321017",
    "1159321061", "1159321065", "1159321069", "1159321199", "1159321267", "1159321295",
    "1159321327", "1159321331",
  ];
  const cyprusOption = byId("enable-cyprus");
  const loadingEmpty = { type: "FeatureCollection", features: [] };
  const polishPlural = new Intl.PluralRules("pl");
  const compactLayout = matchMedia("(max-width: 640px)");
  const detail = byId("challenge-detail");
  const picker = byId("challenge-picker");
  const challengeCards = [...picker.querySelectorAll(".challenge-card")];
  const pinButtons = challengeCards.map((card) => card.querySelector(".challenge-pin"));
  const pinnedChallenges = new Set();
  let pinSettingsRequest;
  const sources = byId("challenge-sources");
  const castleLegend = byId("castle-legend");
  const castleLegendButton = byId("castle-legend-button");
  const sidebar = byId("challenge-sidebar");
  const sidebarButton = byId("challenge-toggle-sidebar");
  const detailVisible = () => !detail.hidden && !byId("challenges-view").hidden;
  let sidebarPreference;
  let current = "parks";
  let extent = "poland";
  let map;
  let mapReady = false;
  let challengeBaseData;
  let usesEmptyBase = false;
  let seaLandRequest;
  let seaOverviewRequest;
  let seaDetailRequest;
  let seaOverview;
  let seaDetail;
  let seaGeometryKey;
  let hoveredArea;
  let areaTooltip;
  const seaSimpleInput = byId('seas-simple');
  const seaOptions = byId('seas-options');
  let castleTooltip;
  let hewelionTooltip;
  let hoveredCastle;
  let parkForestRequest;
  const parkWaterView = {};
  const parkWaterSource = "challenge-polish-water";
  const parkForestLayer = "challenge-forests";
  let pendingFeaturePan = false;
  let progressRequest;
  let saveQueue = Promise.resolve();
  let requestNumber = 0;

  async function getData(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(response.statusText);
    return response.json();
  }

  function catalogue(challenge) {
    if (catalogues.has(challenge)) return catalogues.get(challenge);
    const isParks = challenge === "parks";
    const promise = Promise.all([
      getData(catalogueUrls[challenge]),
      isParks ? getData("/atrakcje-parkow.json") : null,
    ]).then(([data, attractions]) => {
      const entries = new Map(data.features.map((feature) => [feature.properties.id, feature]));
      const loaded = { data, attractions, entries };
      loadedCatalogues.set(challenge, loaded);
      return loaded;
    }).catch((error) => {
      catalogues.delete(challenge);
      throw error;
    });
    catalogues.set(challenge, promise);
    return promise;
  }

  let summariesRequest;
  function loadChallengeSummaries() {
    summariesRequest ||= getData('/api/challenge-catalogues').then((summaries) => {
      for (const [challenge, loaded] of Object.entries(summaries)) {
        if (loadedCatalogues.has(challenge)) continue;
        loaded.entries = new Map(loaded.data.features.map((feature) => [feature.properties.id, feature]));
        loadedCatalogues.set(challenge, loaded);
      }
    }).catch((error) => { summariesRequest = undefined; throw error; });
    return summariesRequest;
  }

  let activeCatalogue;
  const isPark = () => current === "parks";
  const isBliza = () => current === "bliza";
  const isIslands = () => current === "islands";
  const isHewelion = () => current === "hewelion";
  const isCastles = () => current === "castles";
  const isSeas = () => current === "seas";
  const normalize = (name) => name.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replaceAll("ł", "l");
  const nameOf = (entry) => tr(entry.properties.name, entry.properties.english || entry.properties.name);

  function recordProgress(data) {
    for (const category of Object.keys(progress)) progress[category] = new Set(data[category] || []);
    visitedChallengeData = true;
  }

  function loadProgress() {
    progressRequest ||= getData("/api/wyzwania").then(recordProgress).catch((error) => {
      progressRequest = undefined;
      throw error;
    });
    return progressRequest;
  }

  function blizaProgress(lights, visits = progress.latarnia) {
    const domestic = passportLighthouses.filter((id) => visits.has(id)).length;
    if (domestic < 5) return { level: "none", next: "bronze", count: domestic, target: 5 };
    if (domestic < passportLighthouses.length) {
      return { level: "bronze", next: "silver", count: domestic - 5, target: passportLighthouses.length - 5 };
    }
    // The CSV preserves the order in which visits were marked.
    const ordered = [...visits];
    const positions = new Map(ordered.map((id, index) => [id, index]));
    const silverAt = Math.max(...passportLighthouses.map((id) => positions.get(id)));
    const ids = ordered.slice(silverAt + 1).filter((id) => {
      const place = lights.entries.get(id);
      return place && !place.properties.poland && place.properties.country && !ineligibleForeignLighthouses.has(id);
    });
    return { level: ids.length >= 3 ? "gold" : "silver", next: "gold", count: Math.min(ids.length, 3), target: 3 };
  }

  function formatLighthouseCount(count) {
    const forms = { one: "latarnię", few: "latarnie", many: "latarni", other: "latarni" };
    const label = forms[polishPlural.select(count)];
    return tr(`Odwiedzono ${count} ${label}`, `${count} ${count === 1 ? "lighthouse" : "lighthouses"} visited`);
  }

  function islandProgress({ entries }) {
    const total = entries.size;
    const target = Math.max(1, total - 4);
    const count = [...progress.wyspa_grecka].filter((id) => entries.has(id)).length;
    const complete = count >= target;
    const label = Math.min(count, target) + " / " + target + tr(" zdobytych wysp", " islands visited")
      + (complete ? tr(" · Ukończono", " · Completed") : "");
    return { count, target, complete, label };
  }

  function seasProgress(seas) {
    const required = new Set([...seas.entries].filter(([,entry]) => !entry.properties?.optional).map(([id]) => id));
    const total = required.size;
    const target = Math.ceil(total * .9);
    const count = [...progress.morze].filter(id => required.has(id)).length;
    const complete = target > 0 && count >= target;
    return {count, target, total, complete, label: `${count} / ${total}` + tr(" odwiedzonych mórz", " seas visited")
      + tr(` · Cel: ${target} (90%)`, ` · Goal: ${target} (90%)`)
      + (complete ? tr(" · Ukończono", " · Completed") : "")};
  }

  function completedParks(parks) {
    return parks.data.features.filter((feature) => parkProgress(feature, parks).visited).length;
  }

  function hewelionProgress(lions) {
    const required = lions.data.features.filter(({ properties }) => !properties.lastKnown);
    const count = required.filter(({ properties }) => progress.hewelion.has(properties.id)).length;
    const target = required.length;
    return { count, target, label: count + " / " + target + tr(" znalezionych lwów", " lions found") };
  }

  function castleProgress(castles) {
    const tiers = Object.fromEntries(Object.keys(castleCategories).map((tier) => [tier, { count: 0, target: 0 }]));
    for (const { properties } of castles.data.features) {
      const tier = tiers[properties.tier];
      tier.target++;
      if (progress.zamek.has(properties.id)) tier.count++;
    }
    const outstanding = tiers.outstanding;
    const openTarget = Math.ceil(tiers.open.target * 0.75);
    const openCount = Math.min(tiers.open.count, openTarget);
    const count = outstanding.count + openCount;
    const target = outstanding.target + openTarget;
    const complete = target > 0 && count === target;
    const label = tr(
      `Wybitne ${outstanding.count}/${outstanding.target} · Do zwiedzania ${openCount}/${openTarget}`,
      `Outstanding ${outstanding.count}/${outstanding.target} · Open to visitors ${openCount}/${openTarget}`,
    ) + (complete ? tr(" · Ukończono", " · Completed") : "");
    return { count, target, complete, label, tiers };
  }

  function renderChallengeCards() {
    const parks = loadedCatalogues.get("parks");
    const lights = loadedCatalogues.get("bliza");
    const islands = loadedCatalogues.get("islands");
    const lions = loadedCatalogues.get("hewelion");
    const castles = loadedCatalogues.get("castles");
    const parkCard = picker.querySelector('[data-challenge="parks"]');
    const blizaCard = picker.querySelector('[data-challenge="bliza"]');
    const islandCard = picker.querySelector('[data-challenge="islands"]');
    if (parks) {
      const total = parks.data.features.length;
      const completed = completedParks(parks);
      byId("parks-card-progress").textContent = completed + " / " + total + tr(" zaliczonych parków", " parks completed");
      parkCard.classList.toggle("is-complete", total > 0 && completed === total);
    }
    if (lights) {
      const state = blizaProgress(lights);
      renderMedal("bliza-card-medal", state.level);
      byId("bliza-card-progress").textContent = blizaGoalLabel(state);
      blizaCard.classList.toggle("is-complete", state.level === "gold");
    }
    if (islands) {
      const { complete, label } = islandProgress(islands);
      byId("islands-card-progress").textContent = label;
      islandCard.classList.toggle("is-complete", complete);
    }
    if (lions) {
      const { count, target, label } = hewelionProgress(lions);
      byId("hewelion-card-progress").textContent = label;
      picker.querySelector('[data-challenge="hewelion"]').classList.toggle("is-complete", target > 0 && count === target);
    }
    if (castles) {
      const { complete, label } = castleProgress(castles);
      byId("castles-card-progress").textContent = label;
      picker.querySelector('[data-challenge="castles"]').classList.toggle("is-complete", complete);
    }
    const seas = loadedCatalogues.get("seas");
    if (seas) {
      const state = seasProgress(seas);
      byId("seas-card-progress").textContent = state.label;
      picker.querySelector('[data-challenge="seas"]').classList.toggle("is-complete", state.complete);
    }
    orderChallengeCards();
    renderAchievements();
  }

  function achievementProgress() {
    const countriesById = new Map(places.panstwo.map((place) => [place.id, place]));
    const countriesVisited = new Set();
    const regionsVisited = new Set();
    const continentsVisited = new Set();
    const settlementsByCountry = new Map();
    const citiesVisited = [];
    for (const row of savedRows) {
      if (row.tryb === "plan") continue;
      if (row.kategoria === "panstwo" && countriesById.has(row.id)) countriesVisited.add(row.id);
      else if (row.kategoria === "rejon") regionsVisited.add(row.id);
      else if (row.kategoria === "kontynent") continentsVisited.add(row.id);
      else if (row.kategoria === "miasto") {
        citiesVisited.push(row);
        if (!countriesById.has(row.panstwo_id)) continue;
        if (!settlementsByCountry.has(row.panstwo_id)) settlementsByCountry.set(row.panstwo_id, new Set());
        settlementsByCountry.get(row.panstwo_id).add(row.id);
      }
    }
    const visitedCodes = [...countriesVisited].map((id) => countriesById.get(id)?.code);
    let bestCountry;
    let settlementCount = 0;
    for (const [id, settlements] of settlementsByCountry) {
      if (settlements.size <= settlementCount) continue;
      settlementCount = settlements.size;
      bestCountry = countriesById.get(id);
    }
    const result = {
      countries: { count: visitedCodes.filter((code) => code !== "AQ").length },
      settlements: { count: settlementCount, detail: bestCountry && displayPlaceName(bestCountry) },
      "us-states": { count: usStateIds && [...regionsVisited].filter((id) => usStateIds.has(id)).length },
      continents: { count: goalContinents.filter((id) => continentsVisited.has(id)).length },
      antarctica: { count: Number(continentsVisited.has("antarctica") || visitedCodes.includes("AQ")) },
      "trip-countries": { count: tripCountries },
    };
    for (const [id, city] of Object.entries(secretCities)) {
      const [west, south, east, north] = city.bounds;
      const visited = regionsVisited.has(city.region) || citiesVisited.some((row) => {
        if (city.ids.includes(row.id)) return true;
        if (!city.names.includes(normalize(row.nazwa))) return false;
        const code = countriesById.get(row.panstwo_id)?.code;
        if (code && code !== city.country) return false;
        const position = savedCityPosition(row);
        if (!position) return code === city.country;
        const [lon, lat] = position;
        return west <= lon && lon <= east && south <= lat && lat <= north;
      });
      result[id] = { count: Number(visited) };
    }
    const datasets = { metrics: result, visitedCodes, regionsVisited, continentsVisited };
    if (!visitedChallengeData) return datasets;
    const parks = loadedCatalogues.get("parks");
    const lights = loadedCatalogues.get("bliza");
    const islands = loadedCatalogues.get("islands");
    if (parks) result.parks = { count: completedParks(parks) };
    const seas = loadedCatalogues.get("seas");
    if (seas) result.seas = seasProgress(seas);
    if (lights) {
      const state = blizaProgress(lights);
      result.bliza = { count: state.count, target: state.target,
        rank: ["none", "bronze", "silver", "gold"].indexOf(state.level) };
    }
    if (islands) result.islands = islandProgress(islands);
    const lions = loadedCatalogues.get("hewelion");
    if (lions) result.hewelion = hewelionProgress(lions);
    const castles = loadedCatalogues.get("castles");
    if (castles) {
      const state = castleProgress(castles);
      result.castles = state;
      result["castles-all"] = { count: Object.values(state.tiers).reduce((total, tier) => total + tier.count, 0) };
      for (const [tier, visits] of Object.entries(state.tiers)) result["castles-" + tier] = visits;
    }
    return datasets;
  }

  function achievementMetric(rule, { metrics, visitedCodes, regionsVisited, continentsVisited }) {
    const separator = rule.indexOf(":");
    if (separator < 0) return metrics[rule] || {};
    const kind = rule.slice(0, separator);
    const location = rule.slice(separator + 1);
    if (kind === "panstwo") return { count: [...new Set(location.split("|"))].filter((code) => visitedCodes.includes(code)).length };
    if (kind === "rejony") return { count: [...new Set(location.split("|"))].filter((id) => regionsVisited.has(id)).length };
    if (kind === "kontynent") return { count: Number(continentsVisited.has(location)) };
    if (kind === "zamek") {
      if (!visitedChallengeData) return {};
      const ids = new Set(location.split("|"));
      return { count: [...ids].filter((id) => progress.zamek.has(id)).length };
    }
    return { count: Number(location.split("|").some((id) => regionsVisited.has(id))) };
  }

  function achievementState(definition, metrics) {
    const { rule, levels } = definition;
    const metric = developerAllAchievements ? { count: levels.at(-1).target } : achievementMetric(rule, metrics);
    const attained = metric.rank ?? metric.count;
    const tiersReached = levels.filter(({ target }) => attained >= target).length;
    return { metric, attained, tiersReached, complete: tiersReached === levels.length };
  }

  function showAchievementToasts() {
    const container = byId("achievement-notifications");
    if (!achievementNotificationsEnabled()) {
      achievementToastQueue.length = 0;
      container.replaceChildren();
      return;
    }
    while (achievementToastQueue.length && container.children.length < 3) {
      const { definition, tier } = achievementToastQueue.shift();
      const toast = document.createElement("article");
      toast.className = "achievement-toast";
      toast.style.setProperty("--toast-duration", achievementToastDuration + "ms");
      const badge = document.createElement("span");
      badge.className = "achievement-toast-icon";
      badge.textContent = definition.icon;
      badge.setAttribute("aria-hidden", "true");
      const copy = document.createElement("div");
      const label = document.createElement("p");
      label.className = "achievement-toast-label";
      label.textContent = definition.levels.length > 1
        ? tr("Zdobyto poziom osiągnięcia!", "Achievement level unlocked!")
        : tr("Zdobyto osiągnięcie!", "Achievement unlocked!");
      const title = document.createElement("strong");
      title.textContent = tr(...definition.title);
      const goal = document.createElement("p");
      goal.className = "achievement-toast-goal";
      const requirementText = tr(...tier.goal);
      const compactGoal = ["kashubia", "biblical-countries"].includes(definition.id) && requirementText.includes(": ")
        ? requirementText.slice(0, requirementText.indexOf(": ")) + "." : requirementText;
      goal.textContent = (definition.levels.length > 1 ? tr(...tier.label) + " · " : "") + compactGoal;
      copy.append(label, title, goal);
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "×";
      close.setAttribute("aria-label", tr("Zamknij powiadomienie", "Dismiss notification"));
      const countdown = document.createElement("span");
      countdown.className = "achievement-toast-countdown";
      countdown.setAttribute("aria-hidden", "true");
      toast.append(badge, copy, close, countdown);
      let timer;
      const dismiss = () => {
        clearTimeout(timer);
        toast.remove();
        showAchievementToasts();
      };
      close.addEventListener("click", dismiss);
      container.append(toast);
      timer = setTimeout(dismiss, achievementToastDuration);
    }
  }

  function checkAchievementUnlocks(metrics) {
    for (const definition of achievementDefinitions) {
      const { attained, tiersReached } = achievementState(definition, metrics);
      // Unknown or not-yet-loaded metrics must never reset the baseline.
      if (!Number.isFinite(attained)) continue;
      const previous = achievementTiersSeen.get(definition.id);
      achievementTiersSeen.set(definition.id, tiersReached);
      if (achievementNotificationsEnabled() && previous !== undefined && tiersReached > previous) {
        achievementToastQueue.push({ definition, tier: definition.levels[tiersReached - 1] });
      }
    }
    showAchievementToasts();
  }

  function appendAchievementList(card, id, requirement) {
    if (!["kashubia", "biblical-countries"].includes(id)) return;
    const separator = requirement.textContent.indexOf(": ");
    if (separator < 0) return;
    const text = requirement.textContent.slice(separator + 2);
    requirement.textContent = requirement.textContent.slice(0, separator) + ".";
    const details = document.createElement("details");
    details.className = "achievement-place-list";
    details.open = expandedAchievementLists.has(id);
    const toggle = document.createElement("summary");
    const updateLabel = () => {
      toggle.textContent = id === "kashubia"
        ? (details.open ? tr("Ukryj powiaty", "Hide counties") : tr("Pokaż powiaty", "Show counties"))
        : (details.open ? tr("Ukryj kraje", "Hide countries") : tr("Pokaż kraje", "Show countries"));
    };
    updateLabel();
    const list = document.createElement("p");
    list.textContent = text;
    details.append(toggle, list);
    details.addEventListener("toggle", () => {
      if (details.open) expandedAchievementLists.add(id);
      else expandedAchievementLists.delete(id);
      updateLabel();
    });
    card.append(details);
  }

  function achievementGroup(id, pl, en, cards) {
    const group = document.createElement("details");
    group.className = "achievement-group";
    group.dataset.achievementGroup = id;
    group.open = !collapsedAchievementGroups.has(id);
    const summary = document.createElement("summary");
    const heading = document.createElement("h3");
    heading.textContent = tr(pl, en);
    const count = document.createElement("span");
    count.className = "achievement-group-count";
    count.textContent = cards.childElementCount;
    summary.append(heading, count);
    const grid = document.createElement("div");
    grid.className = "achievement-cards";
    grid.append(cards);
    group.append(summary, grid);
    group.addEventListener("toggle", () => {
      if (group.open) collapsedAchievementGroups.delete(id);
      else collapsedAchievementGroups.add(id);
    });
    return group;
  }

  function renderAchievements() {
    const metrics = achievementProgress();
    checkAchievementUnlocks(metrics);
    if (achievementsView.hidden) return;
    const inProgress = document.createDocumentFragment();
    const completed = document.createDocumentFragment();
    let unlocked = 0;
    for (const definition of achievementDefinitions) {
      const { id, rule, icon, title, secret, levels } = definition;
      const { metric, attained, tiersReached, complete } = achievementState(definition, metrics);
      const { goal, description, target } = levels[tiersReached] ?? levels.at(-1);
      const currentBlizaPhase = rule === "bliza" && !complete && metric.rank + 1 === target;
      const shownCount = currentBlizaPhase ? metric.count : attained;
      const shownTarget = currentBlizaPhase ? metric.target : target;
      if (secret && !complete) continue;
      if (complete || tiersReached > 0) unlocked++;
      const card = document.createElement("article");
      card.className = "achievement-card";
      card.dataset.achievement = id;
      card.classList.toggle("is-complete", complete);
      const header = document.createElement("header");
      const badge = document.createElement("span");
      badge.className = "challenge-choice-icon";
      badge.setAttribute("aria-hidden", "true");
      badge.textContent = icon;
      const heading = document.createElement("h4");
      heading.id = "achievement-" + id;
      heading.textContent = tr(...title);
      header.append(badge, heading);
      const requirement = document.createElement("p");
      requirement.className = "achievement-requirement";
      requirement.textContent = tr(...goal);
      const story = document.createElement("p");
      story.textContent = tr(...description);
      card.append(header, requirement, story);
      appendAchievementList(card, id, requirement);
      if (levels.length > 1) {
        const milestones = document.createElement("ol");
        milestones.className = "achievement-tiers";
        for (const [index, tier] of levels.entries()) {
          const item = document.createElement("li");
          if (index === tiersReached) item.setAttribute("aria-current", "step");
          item.classList.toggle("is-reached", index < tiersReached);
          item.textContent = tr(...tier.label) + (index < tiersReached ? " ✓" : "");
          milestones.append(item);
        }
        card.append(milestones);
      }
      const bar = document.createElement("progress");
      bar.max = shownTarget;
      bar.setAttribute("aria-labelledby", heading.id);
      const caption = document.createElement("p");
      caption.className = "achievement-count";
      if (shownCount === undefined) caption.textContent = "–";
      else {
        const value = Math.min(shownCount, shownTarget);
        bar.value = value;
        caption.textContent = `${value} / ${shownTarget}` + (complete ? tr(" · Odblokowano", " · Unlocked") : "")
          + (metric.detail ? " · " + metric.detail : "");
      }
      card.append(bar, caption);
      (complete ? completed : inProgress).append(card);
    }
    const groups = [achievementGroup("in-progress", "W toku", "In progress", inProgress)];
    if (completed.childElementCount) groups.push(achievementGroup("completed", "Ukończone", "Completed", completed));
    byId("achievement-cards").replaceChildren(...groups);
    byId("achievement-summary").textContent = tr(`Odblokowano: ${unlocked}`, `Unlocked: ${unlocked}`);
  }

  async function showAchievements() {
    const sequence = ++achievementLoad;
    ++achievementStatsLoad;
    const status = byId("achievement-status");
    status.textContent = "";
    renderAchievements();
    const configuration = getData("/api/osiagniecia");
    const freshVisits = ready ? refreshMapVisits() : Promise.resolve();
    const states = getData('/api/rejony?catalogue=1&country=US&levels=region').then(({ features }) => {
      usStateIds = new Set(features.filter(({ properties }) =>
        properties.country === "US" && properties.level !== "subregion" && stateCodes.has(properties.alias.split(" ").at(-1).slice(3))
      ).map(({ properties }) => properties.id));
      if (usStateIds.size !== stateCodes.size) {
        usStateIds = undefined;
        throw new Error("Incomplete U.S. states catalogue");
      }
    });
    const freshProgress = saveQueue.then(() => {
      progressRequest = undefined;
      return loadProgress();
    });
    const [config, ...results] = await Promise.allSettled([
      configuration, states, freshVisits, freshProgress, loadChallengeSummaries(),
    ]);
    if (sequence !== achievementLoad) return;
    if (config.status === "rejected") {
      status.textContent = tr("Nie udało się odczytać osiągnięć z pliku osiagniecia.csv.", "Could not load osiagniecia.csv.");
    } else if (config.value.line) {
      status.textContent = tr(`Sprawdź wiersz ${config.value.line} w osiagniecia.csv.`, `Check row ${config.value.line} in osiagniecia.csv.`);
    } else if (results.some(({ status }) => status === "rejected")) {
      status.textContent = tr("Nie udało się wczytać części postępu.", "Some progress could not be loaded.");
    }
    if (config.status === "fulfilled" && config.value.definitions) {
      achievementDefinitions = config.value.definitions;
      developerAllAchievements = Boolean(config.value.developerUnlocked);
      tripCountries = config.value.tripCountries;
    }
    renderAchievements();
  }

  function orderChallengeCards() {
    const container = picker.querySelector(".challenge-cards");
    const rank = (card) => {
      const choice = card.querySelector(".challenge-choice");
      if (pinnedChallenges.has(choice.dataset.challenge)) return 0;
      return choice.classList.contains("is-complete") ? 2 : 1;
    };
    const ordered = [...challengeCards].sort((a, b) => rank(a) - rank(b));
    if (ordered.every((card, index) => container.children[index] === card)) return;
    const focused = document.activeElement;
    container.append(...ordered);
    if (!picker.hidden && focused && container.contains(focused)) focused.focus({ preventScroll: true });
  }

  function renderChallengePins() {
    for (const button of pinButtons) {
      const pinned = pinnedChallenges.has(button.dataset.pinChallenge);
      const name = button.parentElement.querySelector(".challenge-choice-name").textContent;
      button.setAttribute("aria-label", tr("Przypnij wyzwanie", "Pin challenge") + " · " + name);
      button.setAttribute("aria-pressed", String(pinned));
      button.title = pinned ? tr("Odepnij wyzwanie", "Unpin challenge") : tr("Przypnij wyzwanie", "Pin challenge");
      button.textContent = pinned ? "★" : "☆";
    }
    orderChallengeCards();
  }

  function loadChallengePins() {
    const status = byId("challenge-pins-status");
    pinSettingsRequest ||= getData("/api/ustawienia").then(({ layout }) => {
      for (const button of pinButtons) {
        const id = button.dataset.pinChallenge;
        if (layout["pin_" + id] === "on") pinnedChallenges.add(id);
        button.disabled = false;
      }
      status.textContent = "";
      renderChallengePins();
    }).catch(() => {
      pinSettingsRequest = undefined;
      status.textContent = tr("Nie udało się wczytać przypiętych wyzwań.", "Could not load pinned challenges.");
    });
  }

  for (const button of pinButtons) {
    button.addEventListener("click", async () => {
      const id = button.dataset.pinChallenge;
      const pinned = pinnedChallenges.has(id);
      const status = byId("challenge-pins-status");
      const restoreFocus = document.activeElement === button;
      status.textContent = "";
      button.disabled = true;
      try {
        await getData("/api/ustawienia", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ layout: { ["pin_" + id]: pinned ? "off" : "on" } }),
        });
        if (pinned) pinnedChallenges.delete(id);
        else pinnedChallenges.add(id);
      } catch {
        status.textContent = tr("Nie udało się zapisać przypięcia.", "Could not save the pin.");
      } finally {
        button.disabled = false;
        renderChallengePins();
        if (restoreFocus && !picker.hidden && document.activeElement === document.body) button.focus({ preventScroll: true });
      }
    });
  }

  function renderMedal(id, level) {
    const element = byId(id);
    const medals = { bronze: ["🥉", tr("Brązowy medal", "Bronze medal")],
      silver: ["🥈", tr("Srebrny medal", "Silver medal")], gold: ["🥇", tr("Złoty medal", "Gold medal")] };
    const medal = medals[level];
    element.hidden = !medal;
    element.textContent = medal?.[0] || "";
    if (medal) element.setAttribute("aria-label", medal[1]);
    else element.removeAttribute("aria-label");
  }

  function blizaGoalLabel(state) {
    if (state.level === "gold") return tr("Ukończone", "Complete");
    const goals = { bronze: ["brązowej", "bronze"], silver: ["srebrnej", "silver"], gold: ["złotej", "gold"] };
    const [polishGoal, englishGoal] = goals[state.next];
    const remaining = state.target - state.count;
    const foreign = state.next === "gold";
    const polishForms = foreign ? ["zagraniczna latarnia", "zagraniczne latarnie", "zagranicznych latarni"]
      : ["polska latarnia", "polskie latarnie", "polskich latarni"];
    const form = remaining === 1 ? 0 : remaining >= 2 && remaining <= 4 ? 1 : 2;
    const englishPlace = (foreign ? "foreign" : "Polish") + (remaining === 1 ? " lighthouse" : " lighthouses");
    return tr(`Do ${polishGoal} odznaki jeszcze ${remaining} ${polishForms[form]}`,
      `${remaining} more ${englishPlace} for the ${englishGoal} badge`);
  }

  function renderBliza() {
    const lights = loadedCatalogues.get("bliza");
    if (!isBliza() || !lights) return;
    const state = blizaProgress(lights);
    renderMedal("bliza-medal", state.level);
    const goal = byId("bliza-goal-label");
    goal.textContent = blizaGoalLabel(state) + "*";
    byId("bliza-goal").title = tr("* Z wyłączeniem latarni niezaliczanych przez organizatora BLIZY.",
      "* Excludes lighthouses that do not qualify under the BLIZA organizer’s rules.");
    if (state.next === "silver" && state.target - state.count === 1) {
      const id = passportLighthouses.find((id) => !progress.latarnia.has(id));
      const entry = lights.entries.get(id);
      if (entry) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "missing-lighthouse";
        button.textContent = nameOf(entry);
        button.addEventListener("click", () => selectFeature(id, true));
        goal.append(" · ", button);
      }
    }
    const bar = byId("bliza-goal-progress");
    bar.max = state.target;
    bar.value = state.count;
  }

  function parkProgress(feature, parksCatalogue = activeCatalogue) {
    const { id, key } = feature.properties;
    const attractions = parksCatalogue.attractions[key];
    const seen = attractions.filter(([slug]) => progress.atrakcja_parku.has(id + ":" + slug)).length;
    return { attractions, seen, visited: progress.park_narodowy.has(id) };
  }

  function selectedInScope() {
    const entry = activeCatalogue?.entries.get(selected[current]);
    return entry && (!isBliza() || lighthouseVisible(entry)) && (!isCastles() || castleVisible(entry)) ? entry : null;
  }

  function lighthouseVisible(feature) {
    return extent === "world" || feature.properties.poland;
  }

  function castleVisible(feature) {
    return castleVisibility.get(feature.properties.tier) !== false;
  }

  function addCheckbox(container, category, id, labelText, detail = "") {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = progress[category].has(id);
    input.disabled = pending.has(id);
    input.dataset.progressId = id;
    const text = document.createElement("span");
    text.textContent = labelText;
    if (detail) {
      const annotation = document.createElement("small");
      annotation.textContent = detail;
      text.append(annotation);
    }
    input.addEventListener("change", () => saveProgress(category, id, input.checked));
    label.append(input, text);
    container.append(label);
  }

  function renderSelection(focusId) {
    const panel = byId("challenge-selection");
    panel.replaceChildren();
    const entry = selectedInScope();
    panel.hidden = isIslands() || (!isPark() && !entry);
    if (panel.hidden) return;
    if (!entry) {
      panel.textContent = tr("Wybierz park, aby zobaczyć listę atrakcji.", "Select a park to see its attractions.");
      return;
    }
    const title = document.createElement("h4");
    title.tabIndex = -1;
    title.textContent = nameOf(entry);
    panel.append(title);
    if (isHewelion()) {
      const { id, location, location_en, clue, clue_en, lastKnown, approximate } = entry.properties;
      const address = document.createElement("p");
      address.className = "hewelion-location";
      address.textContent = tr(location, location_en);
      const hint = document.createElement("p");
      hint.className = "hewelion-hint";
      hint.textContent = tr(clue, clue_en);
      panel.append(address, hint);
      if (lastKnown || approximate) {
        const note = document.createElement("small");
        note.textContent = lastKnown
          ? tr("Ostatnia znana lokalizacja. Pozycja dodatkowa, poza licznikiem.", "Last known location. Optional, outside the total.")
          : tr("Znacznik wskazuje miejsce przybliżone.", "The marker shows the approximate location.");
        panel.append(note);
      }
      addCheckbox(panel, "hewelion", id, tr("Znaleziony lew", "Lion found"));
    } else if (isCastles()) {
      const { id, site } = entry.properties;
      if (site) {
        const location = document.createElement("p");
        location.textContent = site;
        panel.append(location);
      }
      addCheckbox(panel, "zamek", id, tr("Odwiedzony zamek", "Castle visited"));
    } else if (isSeas()) {
      const {boundary_kind} = entry.properties;
      if (boundary_kind === "location") {
        const note = document.createElement("p");
        note.textContent = tr("Znacznik orientacyjny — brak obrysu w źródle danych.", "Reference marker — no outline available in the source data.");
        panel.append(note);
      }
      if (boundary_kind === 'approximate') {
        const note = document.createElement('p');
        note.textContent = tr('Przybliżony obrys.', 'Approximate outline.');
        panel.append(note);
      }
      if (entry.properties.optional) {
        const note = document.createElement('p');
        note.textContent = tr('Opcjonalne — poza licznikiem wyzwania.', 'Optional — does not count toward completion.');
        panel.append(note);
      }
    } else if (!isPark()) {
      const { id, country, poland } = entry.properties;
      addCheckbox(panel, "latarnia", id, tr("Odwiedzona latarnia", "Lighthouse visited"),
        poland ? tr("Polska", "Poland") : country);
    } else {
      const state = parkProgress(entry);
      const { id } = entry.properties;
      if (state.visited) {
        const summary = document.createElement("p");
        summary.textContent = tr("Park zaliczony", "Park completed");
        panel.append(summary);
      }
      const groups = {
        place: tr("Miejsca", "Places"), animal: tr("Zwierzęta", "Animals"), plant: tr("Rośliny", "Plants"),
      };
      for (const [group, heading] of Object.entries(groups)) {
        const fields = document.createElement("fieldset");
        fields.className = "park-checklist";
        const legend = document.createElement("legend");
        legend.textContent = heading;
        fields.append(legend);
        for (const [slug, name, english, type] of state.attractions) {
          if (type === group) addCheckbox(fields, "atrakcja_parku", id + ":" + slug, tr(name, english));
        }
        panel.append(fields);
      }
      if (state.seen || state.visited) {
        const complete = document.createElement("button");
        complete.type = "button";
        complete.className = "park-completion";
        complete.textContent = state.visited ? tr("Cofnij zaliczenie", "Undo completion") : tr("Zalicz park", "Complete park");
        complete.dataset.progressId = id;
        complete.disabled = pending.has(id);
        complete.addEventListener("click", () => saveProgress("park_narodowy", id, !state.visited));
        panel.append(complete);
      }
    }
    if (focusId) {
      const control = [...panel.querySelectorAll("[data-progress-id]")].find((element) => element.dataset.progressId === focusId);
      (control || title).focus({ preventScroll: true });
    }
  }

  function castleLegendKey(glyph, color, label) {
    const item = document.createElement("li");
    const icon = document.createElement("span");
    icon.className = "castle-marker-key";
    icon.setAttribute("aria-hidden", "true");
    icon.style.setProperty("--castle-color", color);
    icon.textContent = glyph;
    item.append(icon, label);
    return item;
  }

  function renderList() {
    const list = byId("challenge-list");
    const note = byId("challenge-list-note");
    const scroll = list.scrollTop;
    list.replaceChildren();
    note.textContent = "";
    if (!activeCatalogue) return;
    const query = isBliza() ? normalize(lighthouseQuery.trim()) : "";
    let entries = activeCatalogue.data.features;
    const counter = byId("challenge-progress");
    if (isPark()) {
      const completed = entries.filter((feature) => parkProgress(feature).visited).length;
      counter.textContent = completed + " / " + entries.length + " " + tr("zaliczonych parków", "parks completed");
    } else if (isBliza()) {
      counter.textContent = formatLighthouseCount(progress.latarnia.size);
      if (!query) return;
      entries = entries.filter(lighthouseVisible);
    } else if (isHewelion()) {
      counter.textContent = hewelionProgress(activeCatalogue).label;
    } else if (isCastles()) {
      counter.textContent = castleProgress(activeCatalogue).label;
      entries = entries.filter(castleVisible);
    } else {
      counter.textContent = isSeas() ? seasProgress(activeCatalogue).label : islandProgress(activeCatalogue).label;
    }
    const matches = entries.filter((entry) => {
      const { name, english, country } = entry.properties;
      return !query || normalize([name, english, country].filter(Boolean).join(" ")).includes(query);
    }).sort((a, b) => nameOf(a).localeCompare(nameOf(b), document.documentElement.lang));
    const tiers = Object.keys(castleCategories);
    if (isCastles()) matches.sort((a, b) => tiers.indexOf(a.properties.tier) - tiers.indexOf(b.properties.tier));
    if (isSeas()) matches.sort((a,b) => Number(Boolean(a.properties.optional))-Number(Boolean(b.properties.optional)));
    const limit = isCastles() ? matches.length : 100;
    note.textContent = matches.length > limit
      ? tr("Pierwsze 100 wyników. Użyj wyszukiwarki, aby zawęzić listę.", "First 100 results. Use search to narrow the list.")
      : matches.length === 0 ? (isCastles() ? tr("Wszystkie kategorie są ukryte.", "All categories are hidden.")
        : tr("Brak wyników.", "No results.")) : "";
    let previousTier, optionalHeading = false;
    for (const feature of matches.slice(0, limit)) {
      const id = feature.properties.id;
      if (isSeas() && feature.properties.optional && !optionalHeading) {
        optionalHeading = true;
        const heading = document.createElement("li");heading.className = "castle-list-heading";
        heading.textContent = tr("Opcjonalne · poza licznikiem", "Optional · outside the total");list.append(heading);
      }
      if (isCastles() && feature.properties.tier !== previousTier) {
        previousTier = feature.properties.tier;
        const heading = document.createElement("li");
        heading.className = "castle-list-heading";
        heading.textContent = tr(...castleCategories[previousTier].title);
        list.append(heading);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "result";
      if (isIslands()) {
        button.dataset.islandId = id;
        if (selected[current] === id) button.setAttribute("aria-current", "location");
      } else button.setAttribute("aria-pressed", String(selected[current] === id));
      const description = document.createElement("span");
      description.textContent = nameOf(feature);
      if (isBliza() && extent === "world") {
        const metadata = document.createElement("small");
        metadata.textContent = feature.properties.poland ? tr("Polska", "Poland") : feature.properties.country;
        description.append(metadata);
      }
      const counter = document.createElement("strong");
      if (isPark()) {
        const state = parkProgress(feature);
        counter.textContent = state.seen + "/" + state.attractions.length;
      } else {
        const category = isSeas() ? "morze" : isCastles() ? "zamek" : isHewelion() ? "hewelion" : isIslands() ? "wyspa_grecka" : "latarnia";
        counter.textContent = progress[category].has(id) ? "✓" : "";
      }
      button.append(description, counter);
      button.addEventListener("click", () => selectFeature(id, true));
      const row = document.createElement("li");
      row.append(button);
      list.append(row);
    }
    list.scrollTop = scroll;
  }

  function updateMapState() {
    if (!mapReady || !activeCatalogue) return;
    const ids = isPark()
      ? activeCatalogue.data.features.filter((feature) => parkProgress(feature).visited).map((feature) => feature.properties.id)
      : [...progress[isSeas() ? "morze" : isIslands() ? "wyspa_grecka" : "latarnia"]];
    const done = ["in", ["get", "id"], ["literal", ids]];
    const selectedFeature = ["==", ["get", "id"], selected[current]];
    const passportFeature = ["in", ["get", "id"], ["literal", passportLighthouses]];
    const lionsFound = ["in", ["get", "id"], ["literal", [...progress.hewelion]]];
    const castlesVisited = ["in", ["get", "id"], ["literal", [...progress.zamek]]];
    if (isSeas()) {
      map.setPaintProperty('challenge-seas-fill', 'fill-color', ['case', done, '#b695e5', '#cae5f6']);
      map.setPaintProperty('challenge-seas-borders', 'line-color', ['case', selectedFeature, '#3a5939', done, '#8057b6', '#477a9d']);
      map.setPaintProperty('challenge-seas-borders', 'line-width', ['case', selectedFeature, 2.6, 1.15]);
      return;
    }
    map.setPaintProperty("challenge-castles", "circle-color", ["case", selectedFeature, "#30214e", "#fff"]);
    map.setLayoutProperty("challenge-castle-icons", "icon-image", ["concat",
      ["case", castlesVisited, "castle-visited-", "castle-"], ["get", "tier"]]);
    map.setPaintProperty("challenge-lions", "circle-color",
      ["case", lionsFound, "#8057b6", ["==", ["get", "lastKnown"], true], "#74717a", "#bd711d"]);
    map.setPaintProperty("challenge-lions", "circle-stroke-width", ["case", selectedFeature, 3, 1.5]);
    map.setPaintProperty("challenge-cyprus", "fill-color", progress.cypr.has("cyprus") ? "#dfb579" : "#eee2d7");
    map.setPaintProperty("challenge-parks", "fill-color", ["case", done, isSeas() ? "#b695e5" : "#edc65a", isIslands() || isSeas() ? "#cae5f6" : "#dcebd9"]);
    map.setPaintProperty("challenge-park-borders", "line-color", ["case",
      ["all", done, selectedFeature], "#785008", done, "#a27316",
      selectedFeature, "#3a5939", isIslands() || isSeas() ? "#477a9d" : "#6c9067"]);
    map.setPaintProperty("challenge-park-borders", "line-width", ["case", selectedFeature, 2.6, 1.15]);
    map.setPaintProperty("challenge-lighthouses", "circle-color", ["case", done, "#8057b6", "#df9c45"]);
    map.setPaintProperty("challenge-lighthouses", "circle-stroke-color", ["case",
      selectedFeature, "#483161", passportFeature, "#775320", "#fff"]);
    map.setPaintProperty("challenge-lighthouses", "circle-stroke-width", ["case",
      ["all", selectedFeature, passportFeature], 2.5, selectedFeature, 2, passportFeature, 1.5, 1]);
  }

  function resetMap() {
    if (!map || !detailVisible()) return;
    map.setRenderWorldCopies(false);
    if (isHewelion() && activeCatalogue) {
      const bounds = new maplibregl.LngLatBounds();
      for (const { geometry } of activeCatalogue.data.features) bounds.extend(geometry.coordinates);
      if (!onlineEnabled("online_details") && activeCatalogue.data.boundary) {
        const geometry = activeCatalogue.data.boundary.geometry;
        const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
        for (const polygon of polygons) {
          for (const ring of polygon) for (const point of ring) bounds.extend(point);
        }
      }
      map.fitBounds(bounds, { padding: 32, duration: 0 });
    } else if (isIslands()) {
      map.fitBounds(greeceAndCyprusBounds,
        { padding: { top: 22, bottom: 22, left: 22, right: 55 }, duration: 0 });
    } else if (isSeas() || isBliza() && extent === "world") {
      map.jumpTo({ center: [0, 20], zoom: 0.5 });
    } else {
      map.fitBounds(polandBounds, { padding: 22, duration: 0 });
    }
  }

  function updateChallengeSea() {
    if (!mapReady || !detailVisible()) return;
    const blueSea = isSeas() || isBliza() && extent === "world" && visibility.seas;
    map.setPaintProperty("challenge-background", "background-color", blueSea ? mapColors.lake : "#fff");
    map.setLayoutProperty("challenge-land", "visibility", blueSea && !isSeas() ? "visible" : "none");
    for (const layer of ['challenge-sea-land', 'challenge-coastline'])
      map.setLayoutProperty(layer, 'visibility', isSeas() ? 'visible' : 'none');
  }

  function ensureParkForests() {
    if (parkForestRequest || map.getLayer(parkForestLayer)) return;
    parkForestRequest = baseArchive().then(({ archive, header }) => {
      if (!visibility.forests || baseNetworkController.signal.aborted) return;
      mapTileProtocol().add(archive);
      map.addSource(parkForestLayer, {
        type: "vector", tiles: ["pmtiles://" + archive.source.getKey() + "/{z}/{x}/{y}"],
        minzoom: header.minZoom, maxzoom: header.maxZoom, bounds: [10, 46, 28, 58],
      });
      map.addLayer({
        id: parkForestLayer, type: "fill", source: parkForestLayer, "source-layer": "land_cover",
        filter: ["==", ["get", "subtype"], "forest"],
        layout: { visibility: isPark() && visibility.forests ? "visible" : "none" },
        paint: { "fill-color": "#deefdf", "fill-opacity": 0.8 },
      }, "challenge-rivers");
    }).catch(console.warn).finally(() => { parkForestRequest = undefined; });
  }

  function updateParkWaterLayers() {
    if (!mapReady || !detailVisible()) return;
    const detailed = isPark() && map.getZoom() >= polishWaterZoom &&
      containsBounds(parkWaterView.bounds, mapBounds(map));
    for (const [layer, enabled] of [
      ["challenge-rivers", visibility.rivers && !detailed],
      ["challenge-lakes", visibility.lakes && !detailed],
      ["challenge-polish-rivers", visibility.rivers && detailed],
      ["challenge-polish-river-areas", visibility.rivers && detailed],
      ["challenge-polish-lakes", visibility.lakes && detailed],
    ]) {
      map.setLayoutProperty(layer, "visibility", isPark() && enabled ? "visible" : "none");
    }
  }

  function updateParkWater() {
    if (!mapReady || !detailVisible()) return;
    updateParkWaterLayers();
    if (isPark() && (visibility.rivers || visibility.lakes) && map.getZoom() >= polishWaterZoom) {
      loadPolishWater(mapBounds(map), map.getZoom(), map, parkWaterView, parkWaterSource).then(updateParkWaterLayers);
    }
  }

  function syncChallengeOnlineLayers() {
    if (!mapReady) return;
    if (!visibility.forests && map.getLayer(parkForestLayer)) {
      map.removeLayer(parkForestLayer);
      map.removeSource(parkForestLayer);
    }
    for (const [id, active, bounds] of [
      ["challenge-gdansk-streets", isHewelion(), gdanskMapBounds.flat()],
      ["challenge-castle-streets", isCastles(), [13.5, 48.5, 25, 55.6]],
    ]) {
      if (!onlineEnabled("online_details")) {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
        continue;
      }
      if (!map.getSource(id) && active && detailVisible()) {
        map.addSource(id, { type: "raster", tileSize: 256, maxzoom: 19, bounds,
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"] });
        map.addLayer({ id, type: "raster", source: id,
          paint: { "raster-saturation": id === "challenge-castle-streets" ? -0.7 : -0.55 } },
          id === "challenge-gdansk-streets" ? "challenge-gdansk-sea" : "challenge-lions");
      }
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", active && detailVisible() ? "visible" : "none");
    }
  }

  function updateChallengeLayers() {
    if (!mapReady) return;
    syncChallengeOnlineLayers();
    const showGdanskBoundary = isHewelion() && detailVisible() && !onlineEnabled("online_details");
    for (const id of ["challenge-gdansk-sea", "challenge-gdansk-area", "challenge-gdansk-outline",
      "challenge-gdansk-district-hover", "challenge-gdansk-districts", "challenge-gdansk-coastline"]) {
      map.setLayoutProperty(id, "visibility", showGdanskBoundary ? "visible" : "none");
    }
    const showSea = isHewelion() && detailVisible() && (visibility.seas || onlineEnabled("online_details"));
    map.setLayoutProperty("challenge-gdansk-sea", "visibility", showSea ? "visible" : "none");
    map.setPaintProperty("challenge-gdansk-sea", "fill-color", visibility.seas ? mapColors.lake : "#fff");
    if (!detailVisible()) return;
    updateChallengeSea();
    if (map.getLayer(parkForestLayer)) {
      map.setLayoutProperty(parkForestLayer, "visibility", isPark() && visibility.forests ? "visible" : "none");
    } else if (isPark() && visibility.forests) ensureParkForests();
    updateParkWater();
  }

  function updateChallengeItems() {
    hideCastleTooltip();
    const { data } = activeCatalogue;
    const filter = isCastles() ? castleVisible : isBliza() ? lighthouseVisible : null;
    map.getSource("challenge-items").setData(isSeas() ? loadingEmpty : filter ? { ...data, features: data.features.filter(filter) } : data);
  }

  function ensureSeaLand() {
    seaLandRequest ||= getData('/morza-lady.json').then((data) => {
      map.getSource('challenge-sea-land').setData(data);
    }).catch((error) => { seaLandRequest = undefined; console.error(error); });
  }

  function updateSeaGeometry() {
    if (!mapReady || !isSeas() || !activeCatalogue || !detailVisible()) return;
    ensureSeaLand();
    const simple = seaSimpleInput.checked;
    const detailed = !simple && map.getZoom() >= 6;
    if (detailed && !seaDetail) {
      seaDetailRequest ||= getData('/morza-wyzwanie.json').then((data) => {
        seaDetail = data; updateSeaGeometry();
      }).catch((error) => { seaDetailRequest = undefined; console.error(error); });
    } else if (!simple && !detailed && !seaOverview) {
      seaOverviewRequest ||= getData('/morza-mapa.json').then((data) => {
        seaOverview = data; updateSeaGeometry();
      }).catch((error) => { seaOverviewRequest = undefined; console.error(error); });
    }
    let data = detailed && seaDetail || !simple && seaOverview || activeCatalogue.data;
    let key = simple ? 'simple' : detailed && seaDetail ? 'detail' : seaOverview ? 'overview' : 'simple';
    if (key === 'detail') {
      const bounds = map.getBounds();
      const west = bounds.getWest(), east = bounds.getEast(), south = bounds.getSouth(), north = bounds.getNorth();
      const features = data.features.filter((f) => {
        const [w,s,e,n] = f.properties.bounds;
        return s <= north && n >= south && [-360,0,360].some((offset) => w + offset <= east && e + offset >= west);
      });
      key += ':' + features.map((f) => f.properties.id).join(',');
      data = {...data, features};
    }
    if (seaGeometryKey === key) return;
    seaGeometryKey = key;
    map.getSource('challenge-seas').setData(data);
  }

  function showFeatures(reset = false) {
    if (!mapReady || !activeCatalogue || !detailVisible()) return;
    if (usesEmptyBase !== (isHewelion() || isSeas())) {
      usesEmptyBase = isHewelion() || isSeas();
      map.getSource("challenge-base").setData(usesEmptyBase ? loadingEmpty : challengeBaseData);
    }
    const world = isSeas() || isBliza() && extent === "world";
    const bounds = isHewelion() ? gdanskMapBounds : isIslands() ? [[10, 26], [44, 49]] : [[10, 46], [28, 58]];
    map.setMaxBounds(world ? null : bounds);
    const country = ["==", ["get", "kind"], "country"];
    const interactiveCyprus = isIslands() && cyprusOption.checked;
    const countryIds = isIslands()
      ? [...greeceAndNeighbours, ...(interactiveCyprus ? [] : cyprusCountryIds)]
      : [polandCountryId];
    map.setFilter("challenge-countries", world ? country :
      ["all", country, ["in", ["get", "country_id"], ["literal", countryIds]]]);
    map.setLayoutProperty("challenge-park-mask", "visibility", isPark() ? "visible" : "none");
    map.setPaintProperty("challenge-countries", "line-color", isIslands() ? "#d2ced8" : "#a19aab");
    map.setLayoutProperty("challenge-greek-mainland", "visibility", isIslands() ? "visible" : "none");
    if (isIslands()) map.getSource("challenge-greek-mainland").setData(activeCatalogue.data.mainland);
    if (isHewelion()) {
      map.getSource("challenge-gdansk-boundary").setData(activeCatalogue.data.boundary || loadingEmpty);
      map.getSource("challenge-gdansk-details").setData(activeCatalogue.data.offline_map || loadingEmpty);
    }
    map.setLayoutProperty("challenge-cyprus", "visibility", interactiveCyprus ? "visible" : "none");
    map.setPaintProperty("challenge-parks", "fill-opacity", isPark() ? 0.55 : 0.95);
    updateChallengeItems();
    for (const [layer, visible] of Object.entries({
      "challenge-countries": !isHewelion() && !isSeas(),
      "challenge-parks": isPark() || isIslands(), "challenge-park-borders": isPark() || isIslands(),
      'challenge-seas-fill': isSeas(), 'challenge-seas-borders': isSeas(),
      "challenge-lighthouses": isBliza(), "challenge-lions": isHewelion(),
      "challenge-castles": isCastles(), "challenge-castle-icons": isCastles(),
    })) {
      map.setLayoutProperty(layer, "visibility", visible ? "visible" : "none");
    }
    map.resize();
    if (reset) resetMap();
    updateSeaGeometry();
    if (pendingFeaturePan) {
      pendingFeaturePan = false;
      const feature = selectedInScope();
      if (feature) panToFeature(feature);
    }
    updateChallengeLayers();
    updateMapState();
  }

  function panToFeature(feature) {
    if (isBliza() || isHewelion() || isCastles()) {
      const zoom = isHewelion() ? 17 : isCastles() ? 14 : 13;
      map.jumpTo({ center: feature.geometry.coordinates, zoom: Math.max(map.getZoom(), zoom) });
    } else {
      const [west, south, east, north] = feature.properties.bounds;
      if (isSeas()) map.setRenderWorldCopies(west < -180 || east > 180);
      map.fitBounds([[west, south], [east, north]], { padding: 32, maxZoom: 12, duration: 0 });
    }
  }

  function selectFeature(id, pan) {
    selected[current] = id;
    const feature = selectedInScope();
    if (feature && sidebar.hidden) {
      sidebarPreference = true;
      syncSidebar();
    }
    if (feature && pan) {
      if (mapReady) panToFeature(feature);
      else pendingFeaturePan = true;
    }
    const focusedIsland = isIslands() && document.activeElement?.dataset.islandId === id;
    renderList();
    if (focusedIsland) byId("challenge-list").querySelector(`[data-island-id="${id}"]`)?.focus({ preventScroll: true });
    renderSelection();
    updateMapState();
  }

  function basemapWithParkMask(basemap) {
    const poland = basemap.features.find(({ properties }) =>
      properties.kind === "country" && properties.country_id === polandCountryId).geometry;
    const polygons = poland.type === "Polygon" ? [poland.coordinates] : poland.coordinates;
    // The outer ring covers the challenge viewport. Poland's border opens a hole in the mask.
    const outer = [[0, 35], [40, 35], [40, 67], [0, 67], [0, 35]];
    const mask = {
      type: "Feature", properties: { kind: "park-mask" },
      geometry: {
        type: "MultiPolygon",
        coordinates: [[outer, ...polygons.map(([border]) => border)],
          ...polygons.flatMap(([, ...holes]) => holes.map((hole) => [hole]))],
      },
    };
    return { ...basemap, features: [...basemap.features, mask] };
  }

  function createMap(basemap) {
    if (map || !detailVisible()) return;
    challengeBaseData = basemap ? basemapWithParkMask(basemap) : null;
    usesEmptyBase = isHewelion() || isSeas();
    const base = { source: "challenge-base" };
    const items = { source: "challenge-items" };
    const waterLayer = (id, kind, type, source) => ({
      id, type, source, filter: ["==", ["get", "kind"], kind], layout: { visibility: "none" },
      paint: type === "line" ? { "line-color": mapColors.river, "line-width": 1.1 }
        : { "fill-color": mapColors.lake, "fill-outline-color": mapColors.lakeBorder },
    });
    map = new maplibregl.Map({
      container: "challenge-map",
      center: [19.3, 52],
      zoom: 5,
      minZoom: 0,
      maxZoom: 19,
      attributionControl: false,
      renderWorldCopies: false,
      dragRotate: false,
      style: {
        version: 8,
        sources: {
          "challenge-base": { type: "geojson", data: usesEmptyBase ? loadingEmpty : challengeBaseData, maxzoom: 10 },
          'challenge-sea-land': {type: 'geojson', data: loadingEmpty, maxzoom: 9, tolerance: .8},
          'challenge-seas': {type: 'geojson', data: loadingEmpty, maxzoom: 9, tolerance: .8},
          "challenge-greek-mainland": { type: "geojson", data: loadingEmpty, maxzoom: 10 },
          "challenge-gdansk-boundary": { type: "geojson", data: loadingEmpty, maxzoom: 14, tolerance: 0 },
          "challenge-gdansk-details": { type: "geojson", data: loadingEmpty, maxzoom: 14, tolerance: 0 },
          "challenge-items": { type: "geojson", data: loadingEmpty, maxzoom: 14, tolerance: 0 },
          [parkWaterSource]: { type: "geojson", data: loadingEmpty, maxzoom: 14, tolerance: 0.55 },
        },
        layers: [
          { id: "challenge-background", type: "background", paint: { "background-color": "#fff" } },
          { id: "challenge-land", type: "fill", ...base, layout: { visibility: "none" },
            filter: ["==", ["get", "kind"], "country"], paint: { "fill-color": "#fff", "fill-antialias": false } },
          {id: 'challenge-sea-land', type:'fill', source:'challenge-sea-land', layout:{visibility:'none'},
            paint:{'fill-color':'#fff','fill-antialias':false}},
          { id: "challenge-cyprus", type: "fill", ...base, layout: { visibility: "none" },
            filter: ["all", ["==", ["get", "kind"], "country"],
              ["in", ["get", "country_id"], ["literal", cyprusCountryIds]]],
            paint: { "fill-color": "#eee2d7", "fill-antialias": false } },
          waterLayer("challenge-rivers", "river", "line", base.source),
          waterLayer("challenge-lakes", "lake", "fill", base.source),
          waterLayer("challenge-polish-rivers", "river", "line", parkWaterSource),
          waterLayer("challenge-polish-river-areas", "river-area", "fill", parkWaterSource),
          waterLayer("challenge-polish-lakes", "lake", "fill", parkWaterSource),
          { id: "challenge-park-mask", type: "fill", ...base, layout: { visibility: "none" },
            filter: ["==", ["get", "kind"], "park-mask"], paint: { "fill-color": "#fff", "fill-antialias": false } },
          { id: "challenge-countries", type: "line", ...base, filter: ["==", ["get", "kind"], "country"],
            paint: { "line-width": 1, "line-color": "#a19aab" } },
          { id: "challenge-greek-mainland", type: "line", source: "challenge-greek-mainland",
            layout: { visibility: "none" }, paint: { "line-width": 1, "line-color": "#a19aab" } },
          { id: "challenge-parks", type: "fill", ...items, paint: { "fill-color": "#dcebd9", "fill-opacity": 0.95 } },
          { id: "challenge-park-borders", type: "line", ...items, paint: { "line-color": "#6c9067", "line-width": 1 } },
          {id:'challenge-seas-fill',type:'fill',source:'challenge-seas',layout:{visibility:'none'},
            paint:{'fill-color':'#cae5f6','fill-opacity':.38,'fill-antialias':false}},
          {id:'challenge-seas-borders',type:'line',source:'challenge-seas',layout:{visibility:'none'},
            paint:{'line-color':'#477a9d','line-width':1.15}},
          {id:'challenge-coastline',type:'line',source:'challenge-sea-land',layout:{visibility:'none'},
            paint:{'line-color':'#aaa4b2','line-width':.8}},
          { id: "challenge-gdansk-sea", type: "fill", source: "challenge-gdansk-details",
            filter: ["==", ["get", "kind"], "sea"], layout: { visibility: "none" }, paint: { "fill-color": "#edf6fa" } },
          { id: "challenge-gdansk-area", type: "fill", source: "challenge-gdansk-boundary",
            layout: { visibility: "none" }, paint: { "fill-color": "#f5f2fa" } },
          { id: "challenge-gdansk-outline", type: "line", source: "challenge-gdansk-boundary",
            layout: { visibility: "none" }, paint: { "line-color": "#8b7a9f", "line-width": 1.5 } },
          { id: "challenge-gdansk-district-hover", type: "fill", source: "challenge-gdansk-details",
            filter: ["==", ["get", "kind"], "district"], layout: { visibility: "none" },
            paint: { "fill-opacity": 0 } },
          { id: "challenge-gdansk-districts", type: "line", source: "challenge-gdansk-details",
            filter: ["==", ["get", "kind"], "district"], layout: { visibility: "none" },
            paint: { "line-color": "#bdb1cb", "line-width": 0.8 } },
          { id: "challenge-gdansk-coastline", type: "line", source: "challenge-gdansk-details",
            filter: ["==", ["get", "kind"], "coastline"], layout: { visibility: "none" },
            paint: { "line-color": "#7aaec6", "line-width": 1.7 } },
          { id: "challenge-lions", type: "circle", ...items, layout: { visibility: "none" },
            paint: { "circle-radius": 7, "circle-color": "#bd711d", "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } },
          { id: "challenge-castles", type: "circle", ...items, layout: { visibility: "none" },
            paint: { "circle-radius": 10, "circle-color": "#fff" } },
          { id: "challenge-castle-icons", type: "symbol", ...items, layout: { visibility: "none",
            "icon-image": ["concat", "castle-", ["get", "tier"]], "icon-allow-overlap": true, "icon-ignore-placement": true } },
          { id: "challenge-lighthouses", type: "circle", ...items,
            paint: { "circle-color": "#df9c45", "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 2.5, 5, 4, 10, 6],
              "circle-stroke-color": "#fff", "circle-stroke-width": 1 } },
        ],
      },
    });
    map.touchZoomRotate.disableRotation();
    castleTooltip = new maplibregl.Popup({
      closeButton: false, closeOnClick: false, focusAfterOpen: false, offset: 12, className: "castle-tooltip",
    });
    hewelionTooltip = new maplibregl.Popup({
      closeButton: false, closeOnClick: false, focusAfterOpen: false, offset: 12, className: "castle-tooltip",
    });
    areaTooltip = new maplibregl.Popup({closeButton:false, closeOnClick:false, focusAfterOpen:false, offset:12, className:'castle-tooltip'});
    map.on("mousemove", (event) => {
      if (!mapReady || !isHewelion() || !detailVisible() || map.isMoving()) {
        hewelionTooltip.remove();
        return;
      }
      const features = map.queryRenderedFeatures(event.point, {
        layers: ["challenge-lions", "challenge-gdansk-district-hover"],
      });
      const lion = features.find((feature) => feature.layer.id === "challenge-lions");
      const entry = lion && activeCatalogue?.entries.get(lion.properties.id);
      const district = features.find((feature) => feature.layer.id === "challenge-gdansk-district-hover");
      const name = entry ? nameOf(entry) : district?.properties.name;
      if (!name) {
        hewelionTooltip.remove();
        return;
      }
      hewelionTooltip.setText(name).setLngLat(entry ? entry.geometry.coordinates : event.lngLat);
      if (!hewelionTooltip.isOpen()) hewelionTooltip.addTo(map);
    });
    map.on("mouseout", () => hewelionTooltip.remove());
    map.on("mousemove", "challenge-castles", ({ features }) => {
      if (!isCastles() || !detailVisible() || map.isMoving()) return;
      const feature = features?.[0];
      const castle = activeCatalogue?.entries.get(feature?.properties.id);
      if (!castle || hoveredCastle === castle) return;
      hoveredCastle = castle;
      castleTooltip.setText(nameOf(castle)).setLngLat(castle.geometry.coordinates);
      if (!castleTooltip.isOpen()) castleTooltip.addTo(map);
    });
    map.on("mouseleave", "challenge-castles", hideCastleTooltip);
    map.on("movestart", hideCastleTooltip);
    map.on("load", () => {
      for (const [tier, { glyph, color }] of Object.entries(castleCategories)) {
        const icon = document.createElement("canvas");
        icon.width = icon.height = 32;
        const ctx = icon.getContext("2d");
        ctx.font = "bold 25px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (const visited of [false, true]) {
          ctx.clearRect(0, 0, 32, 32);
          ctx.beginPath();
          ctx.arc(16, 16, 16, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
          if (visited) {
            ctx.beginPath();
            ctx.arc(16, 16, 12, 0, 2 * Math.PI);
            ctx.fillStyle = "#4b2883";
            ctx.fill();
          }
          ctx.fillStyle = "#fff";
          ctx.fillText(visited ? "✓" : glyph, 16, 17);
          map.addImage("castle-" + (visited ? "visited-" : "") + tier, ctx.getImageData(0, 0, 32, 32), { pixelRatio: 2 });
        }
      }
      mapReady = true;
      showFeatures(true);
    });
    map.on("moveend", () => { if (isPark()) updateParkWater(); if (isSeas()) updateSeaGeometry(); });
    for (const layer of ["challenge-parks", "challenge-lighthouses", "challenge-cyprus", "challenge-lions", "challenge-castles"]) {
      map.on("click", layer, (event) => {
        if (!activeCatalogue) return;
        if (isSeas()) return;
        if (layer === "challenge-cyprus") {
          toggleCyprus();
          return;
        }
        const ids = [...new Set(event.features.map((feature) => feature.properties.id))];
        if (isIslands() && ids.length) toggleIsland(ids[0]);
        else if (ids.length > 1 && !isPark()) showPointChoices(ids);
        else if (ids.length) selectFeature(ids[0], false);
      });
      map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
    }
    map.on("click", event => {
      if (!isSeas() || !activeCatalogue) return;
      const ids = [...new Set(map.queryRenderedFeatures(event.point,{layers:["challenge-seas-fill"]})
        .map(f => f.properties.id))];
      if (ids.length) toggleSea(ids[0]);
    });
    map.on('mousemove', 'challenge-seas-fill', showAreaHover);
    map.on('mouseleave', 'challenge-seas-fill', hideAreaHover);
    map.on('mousemove', 'challenge-parks', showAreaHover);
    map.on('mouseleave', 'challenge-parks', hideAreaHover);
    map.on('mouseenter','challenge-seas-fill',() => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave','challenge-seas-fill',() => { map.getCanvas().style.cursor = ''; });
  }

  function showAreaHover(event) {
    if (!(isSeas() || isIslands() || isPark()) || map.isMoving() || !event.features?.length) return;
    const entry = activeCatalogue?.entries.get(event.features[0].properties.id);
    if (!entry || hoveredArea === entry) return;
    hoveredArea = entry;
    areaTooltip.setText(nameOf(entry)).trackPointer().addTo(map);
  }

  function hideAreaHover() {
    hoveredArea = null;
    areaTooltip?.remove();
  }

  function hideCastleTooltip() {
    hideAreaHover();
    hoveredCastle = undefined;
    castleTooltip?.remove();
    hewelionTooltip?.remove();
  }

  function showPointChoices(ids) {
    const panel = byId("challenge-selection");
    panel.hidden = false;
    if (sidebar.hidden) {
      sidebarPreference = true;
      syncSidebar();
    }
    const title = document.createElement("h4");
    title.textContent = isSeas() ? tr("Wybierz morze", "Choose a sea") : isHewelion() ? tr("Wybierz lwa", "Choose a lion")
      : isCastles() ? tr("Wybierz zamek", "Choose a castle") : tr("Wybierz latarnię", "Choose a lighthouse");
    panel.replaceChildren(title);
    for (const id of ids) {
      const entry = activeCatalogue?.entries.get(id);
      if (!entry) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "result";
      button.textContent = nameOf(entry);
      button.addEventListener("click", () => selectFeature(id, true));
      panel.append(button);
    }
  }

  function toggleIsland(id) {
    if (activeCatalogue.entries.has(id) && !pending.has(id)) {
      saveProgress("wyspa_grecka", id, !progress.wyspa_grecka.has(id));
    }
  }

  function toggleSea(id) {
    if (!isSeas() || !activeCatalogue?.entries.has(id) || pending.has(id)) return;
    selectFeature(id, false);
    saveProgress('morze', id, !progress.morze.has(id));
  }

  function toggleCyprus() {
    if (isIslands() && activeCatalogue && cyprusOption.checked && !pending.has("cyprus")) {
      saveProgress("cypr", "cyprus", !progress.cypr.has("cyprus"));
    }
  }

  function saveProgress(category, id, value) {
    pending.add(id);
    const target = byId("challenge-status");
    target.textContent = tr("Zapisywanie…", "Saving…");
    const focused = document.activeElement?.dataset.progressId === id;
    const focusedIsland = document.activeElement?.dataset.islandId === id ? document.activeElement : null;
    if (focused) document.activeElement.disabled = true;
    saveQueue = saveQueue.then(async () => {
      try {
        const data = await getData("/api/wyzwania", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kategoria: category, id, odwiedzone: value }),
        });
        recordProgress(data);
        target.textContent = "";
      } catch {
        target.textContent = tr("Nie udało się zapisać postępu. Spróbuj ponownie.", "Could not save progress. Try again.");
      } finally {
        pending.delete(id);
        const restoreIslandFocus = focusedIsland && document.activeElement === focusedIsland && detailVisible();
        renderList();
        if (restoreIslandFocus) byId("challenge-list").querySelector(`[data-island-id="${id}"]`)?.focus();
        renderSelection(focused && detailVisible() ? id : null);
        renderBliza();
        renderChallengeCards();
        updateMapState();
      }
    });
  }

  const toolbarPanels = [[castleLegend, castleLegendButton]];

  function setChallengePanel(next) {
    for (const [panel, button] of toolbarPanels) {
      const open = panel === next;
      panel.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
    }
  }

  function syncSidebar() {
    const open = sidebarPreference ?? !compactLayout.matches;
    sidebar.hidden = !open;
    detail.querySelector(".challenge-workspace").classList.toggle("sidebar-closed", !open);
    sidebarButton.setAttribute("aria-expanded", String(open));
    byId("challenge-sidebar-icon").textContent = open ? "«" : "»";
  }

  function showPicker(restoreFocus = false) {
    requestNumber++;
    detail.hidden = true;
    picker.hidden = false;
    setChallengePanel();
    hideCastleTooltip();
    renderChallengePins();
    loadChallengePins();
    Promise.allSettled([loadChallengeSummaries(), loadProgress()]).then(renderChallengeCards);
    if (restoreFocus) picker.querySelector('[data-challenge="' + current + '"]').focus();
  }

  async function openChallenge(challenge) {
    const sequence = ++requestNumber;
    current = challenge;
    activeCatalogue = null;
    pendingFeaturePan = false;
    picker.hidden = true;
    detail.hidden = false;
    const parks = isPark();
    const bliza = isBliza();
    const islands = isIslands();
    const hewelion = isHewelion();
    const castles = isCastles();
    setChallengePanel();
    hideCastleTooltip();
    syncSidebar();
    const title = byId("challenge-map-title");
    byId("challenge-name").textContent = picker.querySelector(`[data-challenge="${challenge}"] .challenge-choice-name`).textContent;
    title.focus({ preventScroll: true });
    byId("challenge-extent").hidden = !bliza;
    byId("challenge-rules-button").hidden = !bliza;
    byId("park-options-button").hidden = !parks;
    byId("island-options-button").hidden = !islands;
    byId("hewelion-options-button").hidden = !hewelion;
    byId("island-options-button").disabled = islands;
    byId("castle-options-button").hidden = !castles;
    byId('seas-options-button').hidden = !isSeas();
    castleLegendButton.hidden = !castles;
    byId("castle-options-button").disabled = castles;
    byId("park-credit").hidden = !parks;
    byId("park-guide").hidden = !parks;
    byId("park-land-cover-credit").hidden = !parks;
    byId("lighthouse-credit").hidden = !bliza;
    byId("island-credit").hidden = !islands;
    byId("hewelion-credit").hidden = !hewelion;
    byId("gdansk-map-credit").hidden = !hewelion;
    byId("challenge-osm-credit").hidden = !hewelion && !castles;
    byId("castle-credit").hidden = !castles;
    byId("castle-gps-credit").hidden = !castles;
    byId("castle-pwr-credit").hidden = !castles;
    byId("challenge-panel-title").textContent = parks ? tr("Lista parków", "National parks")
      : bliza ? tr("Lista latarni", "Lighthouses") : hewelion ? tr("Lista lwów", "Lions")
      : castles ? tr("Lista zamków", "Castles") : isSeas() ? tr("Lista mórz", "Seas") : tr("Lista wysp", "Islands");
    byId("challenge-hint").textContent = parks
      ? tr("Wybierz park. Zaznacz dowolną atrakcję, aby móc go zaliczyć.",
        "Select a park. Check any attraction to enable park completion.")
      : bliza ? tr("Wybierz latarnię z mapy lub listy i oznacz ją jako odwiedzoną.",
        "Select a lighthouse on the map or list and mark it as visited.")
      : hewelion ? tr("Wybierz lwa na mapie lub liście, aby zobaczyć adres i podpowiedź.",
        "Select a lion on the map or list to see its address and clue.")
      : castles ? tr("Wybierz zamek na mapie lub liście, aby oznaczyć go jako odwiedzony.",
        "Select a castle on the map or list to mark it as visited.")
      : isSeas() ? tr("Kliknij morze, aby zaznaczyć lub cofnąć odwiedzenie.",
        "Click a sea to mark or unmark your visit.")
      : tr("Wybierz nazwę, aby znaleźć wyspę. Kliknij obrys na mapie, aby ją zaliczyć.",
        "Select a name to find the island. Click its outline on the map to mark it as visited.");
    byId("lighthouse-search").hidden = !bliza;
    byId("bliza-goal").hidden = !bliza;
    if (bliza) renderBliza();
    else renderMedal("bliza-medal", "none");
    byId("challenge-search").value = lighthouseQuery;
    byId("challenge-selection").replaceChildren();
    byId("challenge-list-note").textContent = "";
    byId("challenge-status").textContent = "";
    byId("challenge-progress").removeAttribute("title");
    byId("challenge-progress").textContent = tr("Wczytywanie…", "Loading…");
    byId("challenge-list").replaceChildren();
    try {
      const [loaded, , settings] = await Promise.all([
        catalogue(challenge), loadProgress(), islands || castles ? getData("/api/ustawienia") : null,
      ]);
      if (sequence !== requestNumber) return;
      if (islands) {
        cyprusOption.checked = settings.layout.cyprus !== "hide";
        byId("island-options-button").disabled = false;
      }
      if (castles) {
        for (const tier of Object.keys(castleCategories)) castleVisibility.set(tier, settings.layout["castle_" + tier] !== "hide");
        byId("castle-options-button").disabled = false;
      }
      activeCatalogue = loaded;
      renderList();
      renderSelection();
      renderBliza();
      renderChallengeCards();
      try {
        let basemap = null;
        if (!isSeas() && !isHewelion() && !challengeBaseData) {
          basemap = await getData(geographyUrl);
          if (sequence !== requestNumber) return;
          if (map) challengeBaseData = basemapWithParkMask(basemap);
        }
        if (!map) createMap(basemap);
        showFeatures(true);
      } catch {
        byId("challenge-status").textContent = tr("Mapa jest niedostępna. Skorzystaj z listy.", "Map unavailable. Use the list.");
      }
    } catch {
      if (sequence !== requestNumber) return;
      byId("challenge-progress").textContent = tr("Nie udało się wczytać wyzwania.", "Could not load the challenge.");
    }
  }

  document.querySelector('[data-section="challenges-view"]').addEventListener("click", () => showPicker());
  document.querySelector('[data-section="achievements-view"]').addEventListener("click", showAchievements);
  document.addEventListener("atlas-visits-change", () => {
    renderAchievements();
    // Removing/editing a visit can also change the countries represented in a trip.
    clearTimeout(achievementStatsTimer);
    if (!achievementDefinitions.length) return;
    const sequence = ++achievementStatsLoad;
    achievementStatsTimer = setTimeout(async () => {
      try {
        const configuration = await getData("/api/osiagniecia");
        if (sequence !== achievementStatsLoad) return;
        tripCountries = configuration.tripCountries;
        renderAchievements();
      } catch { /* Keep the last known trip progress until it can be refreshed. */ }
    }, 200);
  });
  document.addEventListener("atlas-journal-change", showAchievements);
  function refreshDeveloperProgress(event) {
    if (typeof event?.detail?.achievementsUnlocked === "boolean") developerAllAchievements = event.detail.achievementsUnlocked;
    progressRequest = undefined;
    const refresh = loadProgress().then(() => {
      renderChallengeCards();
      if (activeCatalogue && detailVisible()) {
        renderList();
        renderSelection();
        if (isBliza()) renderBliza();
        if (mapReady) showFeatures();
      }
      if (!achievementsView.hidden) showAchievements();
    }).catch(() => {});
    event?.detail?.tasks?.push(refresh);
  }
  document.addEventListener("atlas-developer-progress-change", refreshDeveloperProgress);
  visitUpdates?.addEventListener("message", (event) => {
    if (event.data === "developer-progress") refreshDeveloperProgress();
    if (event.data === "journal") showAchievements();
  });
  document.addEventListener("atlas-visibility-change", updateChallengeLayers);
  document.addEventListener("atlas-online-change", updateChallengeLayers);
  byId("challenge-back").addEventListener("click", () => showPicker(true));
  byId("park-options-button").addEventListener("click", () => {
    setChallengePanel();
    openVisibilitySettings(true);
  });
  byId("hewelion-options-button").addEventListener("click", () => {
    setChallengePanel();
    byId("hewelion-options-status").textContent = "";
    syncMainSettings();
    byId("hewelion-options").showModal();
  });
  byId("island-options-button").addEventListener("click", () => {
    setChallengePanel();
    byId("island-options-status").textContent = "";
    byId("island-options").showModal();
  });
  cyprusOption.addEventListener("change", async () => {
    const visible = cyprusOption.checked;
    const status = byId("island-options-status");
    status.textContent = "";
    cyprusOption.disabled = true;
    try {
      await getData("/api/ustawienia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout: { cyprus: visible ? "show" : "hide" } }),
      });
      if (isIslands()) showFeatures();
    } catch {
      cyprusOption.checked = !visible;
      status.textContent = tr("Nie udało się zapisać ustawienia.", "Could not save this option.");
    } finally {
      cyprusOption.disabled = false;
    }
  });
  const castleOptions = byId("castle-options");
  const castleOptionsStatus = byId("castle-options-status");
  const castleOptionsInputs = new Map();
  for (const tier of Object.keys(castleCategories)) {
    const label = document.createElement("label");
    label.className = "island-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    const text = document.createElement("span");
    text.textContent = tr(...castleCategories[tier].title);
    label.append(checkbox, text);
    byId("castle-options-categories").append(label);
    castleOptionsInputs.set(tier, { checkbox, text });
    checkbox.addEventListener("change", async () => {
      const visible = checkbox.checked;
      checkbox.disabled = true;
      castleOptionsStatus.textContent = "";
      try {
        await getData("/api/ustawienia", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ layout: { ["castle_" + tier]: visible ? "show" : "hide" } }),
        });
        castleVisibility.set(tier, visible);
        if (isCastles() && activeCatalogue && detailVisible()) {
          renderList();
          renderSelection();
          if (mapReady) updateChallengeItems();
        }
      } catch {
        castleOptionsStatus.textContent = tr("Nie udało się zapisać ustawienia.", "Could not save this setting.");
      } finally {
        checkbox.checked = castleVisibility.get(tier) !== false;
        checkbox.disabled = false;
      }
    });
  }
  document.addEventListener("atlas-achievement-notifications-change", showAchievementToasts);
  document.addEventListener("atlas-settings-loaded", ({ detail: settings }) => {
    seaSimpleInput.checked = settings.layout.seas_simple !== 'off';
    cyprusOption.checked = settings.layout.cyprus !== "hide";
    for (const [tier, { checkbox }] of castleOptionsInputs) {
      const visible = settings.layout["castle_" + tier] !== "hide";
      castleVisibility.set(tier, visible);
      checkbox.checked = visible;
    }
    document.dispatchEvent(new Event("atlas-settings-sync"));
    showAchievements();
  });
  byId('seas-options-button').addEventListener('click', () => seaOptions.showModal());
  seaSimpleInput.addEventListener('change', async () => {
    const simple = seaSimpleInput.checked;
    seaSimpleInput.disabled = true;
    byId('seas-options-status').textContent = '';
    updateSeaGeometry();
    try {
      await getData('/api/ustawienia', {method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({layout:{seas_simple:simple ? 'on' : 'off'}})});
      layout.seas_simple = simple ? 'on' : 'off';
    } catch {
      seaSimpleInput.checked = !simple;
      updateSeaGeometry();
      byId('seas-options-status').textContent = tr('Nie udało się zapisać ustawienia.', 'Could not save this setting.');
    } finally {
      seaSimpleInput.disabled = false;
      document.dispatchEvent(new Event('atlas-settings-sync'));
    }
  });
  document.addEventListener("atlas-language-change", () => {
    for (const [tier, { text }] of castleOptionsInputs) text.textContent = tr(...castleCategories[tier].title);
    renderAchievements();
  });
  byId("castle-options-button").addEventListener("click", () => {
    setChallengePanel();
    castleOptionsStatus.textContent = "";
    for (const [tier, { checkbox, text }] of castleOptionsInputs) {
      if (!checkbox.disabled) checkbox.checked = castleVisibility.get(tier) !== false;
      text.textContent = tr(...castleCategories[tier].title);
    }
    castleOptions.showModal();
  });
  byId("challenge-rules-button").addEventListener("click", () => {
    setChallengePanel();
    byId("bliza-rules").showModal();
    const list = byId("bliza-rules-lighthouses");
    catalogue("bliza").then(({ entries }) => {
      list.replaceChildren(...passportLighthouses.map((id) => {
        const item = document.createElement("li");
        item.textContent = nameOf(entries.get(id));
        return item;
      }));
    }).catch(() => {
      const item = document.createElement("li");
      item.textContent = tr("Nie udało się wczytać wykazu.", "Could not load the list.");
      list.replaceChildren(item);
    });
  });
  castleLegendButton.addEventListener("click", () => {
    const keys = Object.values(castleCategories).map(({ glyph, color, title }) => castleLegendKey(glyph, color, tr(...title)));
    keys.push(castleLegendKey("✓", "#4b2883", tr("Odwiedzony zamek", "Visited castle")));
    byId("castle-legend-keys").replaceChildren(...keys);
  });
  for (const [panel, button] of toolbarPanels) {
    button.addEventListener("click", () => {
      setChallengePanel(panel.hidden ? panel : undefined);
    });
  }
  document.addEventListener("click", (event) => {
    const open = toolbarPanels.find(([panel]) => !panel.hidden);
    if (open && !open.some((element) => element.contains(event.target))) setChallengePanel();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !detailVisible()) return;
    const open = toolbarPanels.find(([panel]) => !panel.hidden);
    if (!open) return;
    setChallengePanel();
    open[1].focus();
  });
  sidebarButton.addEventListener("click", () => {
    sidebarPreference = sidebar.hidden;
    syncSidebar();
  });
  compactLayout.addEventListener("change", syncSidebar);
  for (const button of document.querySelectorAll("[data-challenge]")) {
    button.addEventListener("click", () => openChallenge(button.dataset.challenge));
  }
  for (const button of document.querySelectorAll("[data-extent]")) {
    button.addEventListener("click", () => {
      if (extent === button.dataset.extent) return;
      extent = button.dataset.extent;
      for (const option of document.querySelectorAll("[data-extent]")) {
        option.setAttribute("aria-pressed", String(option === button));
      }
      renderList();
      renderSelection();
      showFeatures(extent === "poland");
    });
  }
  byId("challenge-search").addEventListener("input", (event) => {
    lighthouseQuery = event.target.value;
    renderList();
  });
  byId("challenge-zoom-in").addEventListener("click", () => map?.zoomIn());
  byId("challenge-zoom-out").addEventListener("click", () => map?.zoomOut());
  new ResizeObserver(() => {
    if (detailVisible()) map?.resize();
  }).observe(byId("challenge-map-stage"));
})();
