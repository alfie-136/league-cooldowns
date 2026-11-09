const championInput = document.querySelector("#champion");
const levelInput = document.querySelector("#level");
const hasteInput = document.querySelector("#haste");
const message = document.querySelector("#message");
const results = document.querySelector("#results");

let champions = {};

const formGroups = {
  Jayce: [["hammer", "Hammer"], ["cannon", "Cannon"]],
  Elise: [["human", "Human"], ["spider", "Spider"]],
  Nidalee: [["human", "Human"], ["cougar", "Cougar"]]
};

function getAbilityRanks(level, maxOrder, championId, skillOrder = null) {
  if (skillOrder != null) {
    if (!Array.isArray(skillOrder) || skillOrder.length !== 18 ||
        skillOrder.some(slot => !["Q", "W", "E", "R"].includes(slot))) {
      throw new Error("Invalid custom skill order. Run build_champions.py again.");
    }
    const ranks = { Q: 0, W: 0, E: 0, R: 0 };
    for (const slot of skillOrder.slice(0, level)) ranks[slot]++;
    return ranks;
  }

  const isJayce = championId === "Jayce";
  const startsWithR = ["Jayce", "Karma", "Elise", "Nidalee"].includes(championId);
  const ranks = { Q: 1, W: 1, E: 1, R: startsWithR ? 1 : 0 };

  for (let currentLevel = 4; currentLevel <= level; currentLevel++) {
    if (!isJayce && [6, 11, 16].includes(currentLevel)) {
      ranks.R++;
      continue;
    }
    const rankLimit = Math.min(isJayce ? 6 : 5, Math.ceil(currentLevel / 2));
    const ability = maxOrder.find(slot => ranks[slot] < rankLimit);
    if (!ability) throw new Error("Could not allocate an ability point.");
    ranks[ability]++;
  }
  return ranks;
}

function adjustedCooldown(baseCooldown, haste) {
  return baseCooldown * 100 / (100 + haste);
}

function addAbility(parent, slot, ability, rank, haste, showRank = true) {
  const line = document.createElement("p");
  line.className = "ability-card";
  const rankLabel = showRank ? ` (rank ${rank})` : "";

  if (!ability) {
    line.textContent = `${slot}: missing ability data`;
  } else if ((ability.notApplicable || ability.reviewStatus === "not_applicable")) {
    line.textContent = `${slot} — ${ability.name}: N/A`;
  } else if (rank === 0) {
    line.textContent = `${slot} — ${ability.name}: not learned`;
  } else if (ability.noCooldownRanks?.includes(rank)) {
    line.textContent = `${slot} — ${ability.name}${rankLabel}: Toggle`;
  } else {
    const base = ability.baseCooldowns?.[rank - 1];
    if (typeof base !== "number" || !Number.isFinite(base) || base <= 0) {
      line.textContent = `${slot} — ${ability.name}${rankLabel}: needs cooldown data`;
      } else {
      const cooldown = adjustedCooldown(base, haste);
      line.textContent = `${slot} — ${ability.name}${rankLabel}: ${cooldown.toFixed(2)} seconds`;
    }
  }
  parent.append(line);
}

// Use the most recent reached breakpoint; do not interpolate between levels.
function cooldownAtLevel(steps, level) {
  if (!Array.isArray(steps)) return null;
  let value = null;
  for (const step of steps) {
    if (step.level > level) break;
    value = step.seconds;
  }
  return value;
}

function addLevelCooldown(parent, ability, weapon, level, haste) {
  const line = document.createElement("p");
  line.className = "ability-card";
  const base = cooldownAtLevel(ability?.cooldownsByLevel, level);
  const valid = typeof base === "number" && Number.isFinite(base) && base > 0;
  if (valid) {
    const cooldown = adjustedCooldown(base, haste).toFixed(2);
    line.textContent = `Q — ${ability.name}: ${cooldown} seconds`;
  } else {
    line.textContent = `Q — ${ability?.name || weapon}: needs level cooldown data`;
  }
  parent.append(line);
}

function update() {
  results.replaceChildren();
  // Reuse the existing two-column form styles for both champions.
  results.classList.remove("jayce-results");

  const level = Number(levelInput.value);
  const haste = Number(hasteInput.value);
  const search = championInput.value.trim().toLowerCase();
  const match = Object.entries(champions).find(([id, champion]) =>
    id.toLowerCase() === search || champion.name.toLowerCase() === search
  );
  const championId = match?.[0];
  const champion = match?.[1];

  if (!levelInput.value || !Number.isInteger(level) || level < 3 || level > 18) {
    message.textContent = "Enter a whole level from 3 to 18.";
    return;
  }
  if (!hasteInput.value || !Number.isFinite(haste) || haste < 0) {
    message.textContent = "Enter ability haste of zero or more.";
    return;
  }
  if (!champion) {
    message.textContent = "Type a champion's full name or choose a suggestion.";
    return;
  }


  try {
    // Udyr shows every stance without inferring which ones the player learned.
    const isUdyr = championId === "Udyr";
    const ranks = isUdyr
      ? { Q: 1, W: 1, E: 1, R: 1 }
      : championId === "Aphelios"
        ? { R: Number(level >= 6) + Number(level >= 11) + Number(level >= 16) }
        : getAbilityRanks(level, champion.maxOrder, championId, champion.skillOrder);
    const groups = formGroups[championId];

    if (championId === "Aphelios") {
      for (const weapon of ["calibrum", "severum", "gravitum", "infernum", "crescendum"]) {
        addLevelCooldown(results, champion.forms?.[weapon]?.Q, weapon, level, haste);
      }
      addAbility(results, "R", champion.abilities?.R, ranks.R, haste);
    } else if (groups) {
      results.classList.add("jayce-results");
      for (const [form, title] of groups) {
        const group = document.createElement("section");
        group.className = "form-group";
        const heading = document.createElement("h2");
        heading.textContent = title;
        group.append(heading);
        for (const slot of ["Q", "W", "E"]) {
          // Nidalee's cougar abilities scale with her R rank.
          const rank = championId === "Nidalee" && form === "cougar"
            ? ranks.R : ranks[slot];
          addAbility(group, slot, champion.forms?.[form]?.[slot], rank, haste);
        }
        results.append(group);
      }
      addAbility(results, "R", champion.abilities?.R, ranks.R, haste);
    } else {
      for (const slot of ["Q", "W", "E", "R"]) {
        addAbility(results, slot, champion.abilities?.[slot], ranks[slot], haste, !isUdyr);
      }
    }
    message.textContent = "";
  } catch (error) {
    results.replaceChildren();
    message.textContent = error.message;
  }
}

function changeNumber(input, amount, minimum, maximum = Infinity) {
  const current = input.valueAsNumber;
  const value = Number.isFinite(current) ? current : minimum;
  let next = value + amount;
  if (input === levelInput) next = Math.round(next);
  input.value = Math.min(maximum, Math.max(minimum, next));
  update();
}

async function start() {
  try {
    const response = await fetch("data/champions.json");
    if (!response.ok) throw new Error(`Could not load champions.json (${response.status}).`);
    const data = await response.json();
    if (data.schemaVersion !== 1 || !data.champions) {
      throw new Error("Unexpected JSON format. Run build_champions.py again.");
    }
    champions = data.champions;
    const suggestions = document.querySelector("#champion-options");
    suggestions.replaceChildren();
    const sortedChampions = Object.values(champions).sort((a, b) => a.name.localeCompare(b.name));
    for (const champion of sortedChampions) {
      const option = document.createElement("option");
      option.value = champion.name;
      suggestions.append(option);
    }
    championInput.value = "";
    championInput.addEventListener("input", update);
    levelInput.addEventListener("input", update);
    hasteInput.addEventListener("input", update);
    for (const [selector, input, amount, minimum, maximum] of [
      ["#level-minus", levelInput, -1, 3, 18],
      ["#level-plus", levelInput, 1, 3, 18],
      ["#haste-minus", hasteInput, -5, 0, Infinity],
      ["#haste-plus", hasteInput, 5, 0, Infinity]
    ]) {
      document.querySelector(selector).addEventListener("click", () => {
        changeNumber(input, amount, minimum, maximum);
      });
    }
    update();
  } catch (error) {
    results.replaceChildren();
    message.textContent = error.message;
  }
}

start();
