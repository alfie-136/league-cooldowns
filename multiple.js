const STORAGE_KEY = "league-cooldowns-team-v1";
const WEAPONS = ["calibrum", "severum", "gravitum", "infernum", "crescendum"];
const FORMS = {
  Jayce: [["hammer", "Hammer"], ["cannon", "Cannon"]],
  Elise: [["human", "Human"], ["spider", "Spider"]],
  Nidalee: [["human", "Human"], ["cougar", "Cougar"]]
};
const TIMER_DURATIONS = [300, 180, 240];
const STATIC_COOLDOWN_NOTES = {
  Talon: { E: "CD: 2" },
  Singed: { Q: "SC: 1" },
  Yuumi: { W: "SC: 10/5/0" },
  Veigar: { W: "8–0s based on Phenomenal Evil stacks" },
  Zeri: { Q: "SC: 1/AS"}
};
let champions = {};
let rows = [];
let state = loadState();
let lastCancellation = null;

function emptySlot() {
  return { championId: "", level: 3, haste: 0, ionian: false, crimson: false, cosmic: false, timers: [0, 0, 0], abilityTimers: {} };
}
function loadState() {
  const fallback = () => Array.from({ length: 5 }, emptySlot);
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!Array.isArray(saved) || saved.length !== 5) return fallback();
    return saved.map((item, index) => ({
      championId: typeof item?.championId === "string" ? item.championId : "",
      level: Number.isInteger(item?.level) && item.level >= 3 && item.level <= 18 ? item.level : 3,
      haste: Number.isFinite(item?.haste) && item.haste >= 0 ? item.haste : 0,
      ionian: item?.ionian === true && !(index === 2 && item?.crimson === true),
      crimson: index === 2 && item?.crimson === true,
      cosmic: item?.cosmic === true,
      abilityTimers: item?.abilityTimers && typeof item.abilityTimers === "object" && !Array.isArray(item.abilityTimers)
        ? Object.fromEntries(Object.entries(item.abilityTimers).filter(([, value]) => Number.isFinite(value) && value > 0))
        : {},
      timers: TIMER_DURATIONS.map((_, i) => Number.isFinite(item?.timers?.[i]) && item.timers[i] > 0 ? item.timers[i] : 0)
    }));
  } catch { return fallback(); }
}
function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* Calculator still works without storage. */ }
}
function canUndoCancellation() {
  if (!lastCancellation) return false;
  const slot = state[lastCancellation.index];
  if (!slot || slot.championId !== lastCancellation.championId) return false;
  const current = lastCancellation.kind === "ability"
    ? slot.abilityTimers[lastCancellation.key] || 0
    : slot.timers[lastCancellation.key];
  return current === 0;
}
function updateUndoButton() {
  const button = document.querySelector("#undo-cancel");
  if (!button) return;
  button.disabled = !canUndoCancellation();
  button.title = button.disabled ? "No timer cancellation to undo" : "Restore the last cancelled timer's original countdown";
}
function rememberCancellation(index, kind, key, deadline) {
  lastCancellation = { index, kind, key, deadline, championId: state[index].championId };
}
function forgetCancellationFor(index, kind = null, key = null) {
  if (lastCancellation?.index === index &&
      (kind === null || (lastCancellation.kind === kind && lastCancellation.key === key))) {
    lastCancellation = null;
  }
}
function undoCancellation() {
  if (!canUndoCancellation()) { updateUndoButton(); return; }
  const cancelled = lastCancellation;
  const slot = state[cancelled.index];
  lastCancellation = null;
  if (cancelled.kind === "ability") slot.abilityTimers[cancelled.key] = cancelled.deadline;
  else slot.timers[cancelled.key] = cancelled.deadline;
  saveState(); tickTimers();
}

function getAbilityRanks(level, order, id, skillOrder = null) {
  if (skillOrder != null) {
    if (!Array.isArray(skillOrder) || skillOrder.length !== 18 ||
        skillOrder.some(slot => !["Q", "W", "E", "R"].includes(slot))) {
      throw new Error("Invalid custom skill order. Run build_champions.py again.");
    }
    const ranks = { Q: 0, W: 0, E: 0, R: 0 };
    for (const slot of skillOrder.slice(0, level)) ranks[slot]++;
    return ranks;
  }

  const jayce = id === "Jayce";
  const ranks = { Q: 1, W: 1, E: 1, R: ["Jayce", "Karma", "Elise", "Nidalee"].includes(id) ? 1 : 0 };
  for (let current = 4; current <= level; current++) {
    if (!jayce && [6, 11, 16].includes(current)) { ranks.R++; continue; }
    const limit = Math.min(jayce ? 6 : 5, Math.ceil(current / 2));
    const slot = order.find(key => ranks[key] < limit);
    if (!slot) throw new Error("Check champion maxing order.");
    ranks[slot]++;
  }
  return ranks;
}
function cooldownAtLevel(steps, level) {
  if (!Array.isArray(steps)) return null;
  let value = null;
  for (const step of steps) {
    if (step.level > level) break;
    value = step.seconds;
  }
  return value;
}
function adjustedCooldown(base, haste) { return base * 100 / (100 + haste); }
function numberText(value) { return value.toFixed(2).replace(/\.?0+$/, ""); }
function cooldownEntry(ability, rank, haste, label = "", baseOverride = undefined) {
  if ((ability?.notApplicable || ability?.reviewStatus === "not_applicable") || rank === 0) return { label, value: "—", detail: rank === 0 ? "Not learned" : "Not applicable" };
  if (ability?.noCooldownRanks?.includes(rank)) return { label, value: "0", detail: `${ability.name} · rank ${rank} · no cooldown` };
  const base = baseOverride === undefined ? ability?.baseCooldowns?.[rank - 1] : baseOverride;
  if (typeof base !== "number" || !Number.isFinite(base) || base <= 0) return { label, value: "?", detail: "Missing cooldown data" };
  return { label, value: numberText(adjustedCooldown(base, haste)), seconds: adjustedCooldown(base, haste), detail: `${ability.name}${rank ? ` · rank ${rank}` : ""}` };
}
function abilityEntries(id, champion, level, haste) {
  const output = { Q: [], W: [], E: [], R: [] };
  if (id === "Aphelios") {
    for (const weapon of WEAPONS) {
      const ability = champion.forms?.[weapon]?.Q;
      const base = cooldownAtLevel(ability?.cooldownsByLevel, level);
      const entry = cooldownEntry(ability, 1, haste, ability?.name || weapon, base);
      entry.detail = ability?.name || weapon;
      output.Q.push(entry);
    }
    const rank = Number(level >= 6) + Number(level >= 11) + Number(level >= 16);
    output.R.push(cooldownEntry(champion.abilities?.R, rank, haste));
    return output;
  }
  if (id === "Udyr") {
    for (const slot of "QWER") {
      const entry = cooldownEntry(champion.abilities?.[slot], 1, haste);
      entry.detail = champion.abilities?.[slot]?.name || slot;
      output[slot].push(entry);
    }
    return output;
  }
  const ranks = getAbilityRanks(level, champion.maxOrder, id, champion.skillOrder);
  if (FORMS[id]) {
    for (const [form, title] of FORMS[id]) {
      for (const slot of "QWE") {
        const rank = id === "Nidalee" && form === "cougar" ? ranks.R : ranks[slot];
        output[slot].push(cooldownEntry(champion.forms?.[form]?.[slot], rank, haste, title));
      }
    }
    output.R.push(cooldownEntry(champion.abilities?.R, ranks.R, haste));
  } else {
    for (const slot of "QWER") {
      const entry = cooldownEntry(champion.abilities?.[slot], ranks[slot], haste);
      entry.note = STATIC_COOLDOWN_NOTES[id]?.[slot] || "";
      output[slot].push(entry);
    }
  }
  return output;
}
function make(tag, className = "", text = "") {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}
function updateAbilities(index) {
  rows[index].abilityButtons = [];
  const slot = state[index];
  const champion = champions[slot.championId];
  let entries = null;
  try {
    if (champion) entries = abilityEntries(slot.championId, champion, slot.level, slot.haste);
  } catch (error) {
    for (const cell of rows[index].abilityCells) { cell.textContent = "?"; cell.title = error.message; }
    return;
  }
  for (const [i, key] of [..."QWER"].entries()) {
    const cell = rows[index].abilityCells[i];
    cell.replaceChildren();
    cell.title = "";
    const values = entries?.[key] || [];
    cell.classList.toggle("multi", values.length > 1);
    if (!values.length) { cell.append(make("span", "ability-value", "—")); continue; }
    for (const entry of values) {
      const wrap = make("div", "ability-entry");
      wrap.title = entry.detail;
      if (entry.note) wrap.append(make("span", "ability-note", entry.note));
      if (entry.label) wrap.append(make("span", "ability-label", entry.label));
      wrap.append(make("span", "ability-value", entry.value));
      if (Number.isFinite(entry.seconds) && entry.seconds > 0) {
        const timerKey = [slot.championId, key, entry.label || "standard"].join(":");
        const button = make("button", "ability-timer");
        button.type = "button";
        button.addEventListener("click", () => {
          const now = Date.now();
          const active = remainingSeconds(state[index].abilityTimers[timerKey] || 0, now) > 0;
          if (active) {
            rememberCancellation(index, "ability", timerKey, state[index].abilityTimers[timerKey]);
            delete state[index].abilityTimers[timerKey];
          } else {
            forgetCancellationFor(index, "ability", timerKey);
            state[index].abilityTimers[timerKey] = now + entry.seconds * 1000;
          }
          saveState(); tickTimers();
        });
        rows[index].abilityButtons.push({ button, timerKey, label: `${key}${entry.label ? " " + entry.label : ""}`, seconds: entry.seconds });
        wrap.append(button);
      }
      cell.append(wrap);
    }
  }
  tickAbilityTimers();
}
function stepper(index, key, amount, min, max) {
  const wrapper = make("div", "stepper");
  const minus = make("button", "", "−");
  const input = make("input");
  const plus = make("button", "", "+");
  input.type = "number"; input.min = min; if (Number.isFinite(max)) input.max = max;
  input.step = key === "level" ? "1" : "any";
  input.value = state[index][key];
  input.setAttribute("aria-label", `Enemy ${index + 1} ${key}`);
  minus.type = plus.type = "button";
  minus.setAttribute("aria-label", `Enemy ${index + 1}: decrease ${key} by ${amount}`);
  plus.setAttribute("aria-label", `Enemy ${index + 1}: increase ${key} by ${amount}`);
  function commit(value) {
    if (!Number.isFinite(value)) value = state[index][key];
    if (key === "level") value = Math.round(value);
    state[index][key] = Math.min(max, Math.max(min, value));
    input.value = state[index][key];
    minus.disabled = state[index][key] <= min;
    plus.disabled = state[index][key] >= max;
    saveState(); updateAbilities(index);
  }
  minus.addEventListener("click", () => commit(state[index][key] - amount));
  plus.addEventListener("click", () => commit(state[index][key] + amount));
  input.addEventListener("change", () => commit(input.value === "" ? state[index][key] : input.valueAsNumber));
  minus.disabled = state[index][key] <= min; plus.disabled = state[index][key] >= max;
  wrapper.append(minus, input, plus);
  return wrapper;
}
function summonerHaste(slot) {
  return (slot.crimson ? 20 : slot.ionian ? 10 : 0) + (slot.cosmic ? 18 : 0);
}
function timerDuration(index, timer) {
  return TIMER_DURATIONS[timer] * 100 / (100 + summonerHaste(state[index]));
}
function summonerControls(index) {
  const controls = make("div", "summoner-controls");
  const options = [["ionian", "+10", "Ionian Boots of Lucidity"]];
  if (index === 2) options.push(["crimson", "+20", "Crimson Lucidity upgraded boots"]);
  options.push(["cosmic", "+18", "Cosmic Insight"]);
  const buttons = [];

  for (const [key, text, fullName] of options) {
    const button = make("button", "summoner-toggle", text);
    button.type = "button";
    button.setAttribute("aria-label", `Enemy ${index + 1}: ${fullName}, ${text} summoner spell haste`);
    button.setAttribute("aria-pressed", String(state[index][key]));
    button.title = `${fullName}: ${text} summoner spell haste; affects new timers only`;
    buttons.push([key, button]);
    button.addEventListener("click", () => {
      state[index][key] = !state[index][key];
      // Ordinary and upgraded boots are alternatives, not additive.
      if (state[index][key] && key === "ionian") state[index].crimson = false;
      if (state[index][key] && key === "crimson") state[index].ionian = false;
      for (const [option, control] of buttons) {
        control.setAttribute("aria-pressed", String(state[index][option]));
      }
      saveState(); tickTimers();
    });
    controls.append(button);
  }
  return controls;
}
function remainingSeconds(deadline, now = Date.now()) { return Math.max(0, Math.ceil((deadline - now) / 1000)); }
function formatTime(seconds) { return `${seconds}s`; }
function abilityTimeText(milliseconds) {
  return (Math.ceil(milliseconds / 100) / 10).toFixed(1) + "s";
}
function tickAbilityTimers() {
  const now = Date.now();
  rows.forEach((row, index) => {
    for (const { button, timerKey, label, seconds } of row.abilityButtons || []) {
      const deadline = state[index].abilityTimers[timerKey] || 0;
      const remaining = Math.max(0, deadline - now);
      const active = remaining > 0;
      const text = active ? abilityTimeText(remaining) : deadline ? "Ready" : "Start";
      if (button.textContent !== text) button.textContent = text;
      button.classList.toggle("running", active);
      button.classList.toggle("ready", !active && deadline > 0);
      button.title = active ? "Tap to cancel" : `Start ${numberText(seconds)} seconds`;
      button.setAttribute("aria-label", `Enemy ${index + 1}: ${label}, ${active ? text + " remaining; tap to cancel" : "start " + numberText(seconds) + " seconds"}`);
    }
  });
}
function tickTimers() {
  rows.forEach((row, index) => {
    row.timerButtons.forEach((button, timer) => {
      const seconds = remainingSeconds(state[index].timers[timer]);
      const running = seconds > 0;
      const used = state[index].timers[timer] > 0;
      const label = ["Flash", "Ignite/Barrier", "240-second timer"][timer];
      const text = running ? formatTime(seconds) : used ? "Ready" : formatTime(Math.ceil(timerDuration(index, timer)));
      if (button.textContent !== text) button.textContent = text;
      button.classList.toggle("running", running);
      button.classList.toggle("ready", !running && used);
      button.setAttribute("aria-label", `Enemy ${index + 1}: ${label}, ${running ? formatTime(seconds) + ' remaining. Tap to cancel' : 'tap to start'}`);
      button.title = running ? "Tap to cancel" : `Start ${numberText(timerDuration(index, timer))} seconds (${summonerHaste(state[index])} summoner haste)`;
    });
  });
  tickAbilityTimers();
  updateUndoButton();
}
function renderTeam() {
  const tbody = document.querySelector("#team");
  tbody.replaceChildren(); rows = [];
  state.forEach((slot, index) => {
    const tr = make("tr");
    const levelCell = make("td"); const hasteCell = make("td"); const championCell = make("td");
    const cells = Array.from({ length: 4 }, () => make("td"));
    const timerButtons = [];
    rows.push({ abilityCells: cells, timerButtons, abilityButtons: [] });
    levelCell.append(stepper(index, "level", 1, 3, 18));
    hasteCell.append(stepper(index, "haste", 5, 0, Infinity));
    const search = make("input", "champion-search");
    search.id = `champion-${index}`;
    search.type = "search"; search.setAttribute("list", "champion-options");
    search.autocomplete = "off"; search.placeholder = "Search champion";
    search.value = champions[slot.championId]?.name || "";
    search.addEventListener("input", () => {
      const value = search.value.trim().toLowerCase();
      const found = Object.entries(champions).find(([id, c]) => id.toLowerCase() === value || c.name.toLowerCase() === value);
      const nextId = found?.[0] || "";
      // Clear a previous enemy's timers when a different valid champion is selected.
      if (found && nextId !== state[index].championId) {
        forgetCancellationFor(index);
        state[index].timers = [0, 0, 0];
        state[index].abilityTimers = {};
      }
      state[index].championId = nextId;
      search.setAttribute("aria-invalid", value && !found ? "true" : "false");
      saveState(); updateAbilities(index); tickTimers();
    });
    search.setAttribute("aria-label", `Enemy ${index + 1} champion`);
    championCell.append(search, summonerControls(index));
    tr.append(levelCell, hasteCell, championCell, ...cells);
    TIMER_DURATIONS.forEach((duration, timer) => {
      const cell = make("td"); const button = make("button", "timer"); button.type = "button";
      button.addEventListener("click", () => {
        const now = Date.now();
        if (remainingSeconds(state[index].timers[timer], now) > 0) {
          rememberCancellation(index, "summoner", timer, state[index].timers[timer]);
          state[index].timers[timer] = 0;
        } else {
          forgetCancellationFor(index, "summoner", timer);
          state[index].timers[timer] = now + timerDuration(index, timer) * 1000;
        }
        saveState(); tickTimers();
      });
      cell.append(button); tr.append(cell); timerButtons.push(button);
    });
    tbody.append(tr); updateAbilities(index);
  });
  tickTimers();
}
async function start() {
  const status = document.querySelector("#status");
  try {
    const response = await fetch("data/champions.json");
    if (!response.ok) throw new Error(`Could not load champion data (${response.status}).`);
    const data = await response.json();
    if (data.schemaVersion !== 1 || !data.champions) throw new Error("Unexpected champion data format.");
    champions = data.champions;
    const suggestions = document.querySelector("#champion-options");
    for (const champion of Object.values(champions).sort((a, b) => a.name.localeCompare(b.name))) {
      const option = make("option"); option.value = champion.name; suggestions.append(option);
    }
    renderTeam(); status.textContent = "";
    document.querySelector("#reset-team").addEventListener("click", () => {
      if (!window.confirm("Clear all five champions, levels, haste values and timers?")) return;
      lastCancellation = null;
      state = Array.from({ length: 5 }, emptySlot); saveState(); renderTeam();
    });
    document.querySelector("#undo-cancel")?.addEventListener("click", undoCancellation);
    document.querySelector("#level-all")?.addEventListener("click", () => {
      if (rows.length !== 5) return;
      state.forEach(slot => { slot.level = Math.min(18, slot.level + 1); });
      saveState(); renderTeam();
    });
    setInterval(tickTimers, 250);
    document.addEventListener("visibilitychange", tickTimers);
  } catch (error) { status.textContent = error.message; }
}
start();
