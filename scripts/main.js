const MODULE_ID = "pf2e-quick-ability-builder";
const MODULE_TITLE = "PF2e Quick Ability Builder";
const L = (key) => game.i18n.localize(`PF2E_QUICK_ABILITY_BUILDER.${key}`);
const LF = (key, data) => game.i18n.format(`PF2E_QUICK_ABILITY_BUILDER.${key}`, data);

let activeBuilder;
let presets = [];
let presetsLoaded = false;

// ─── Presets ────────────────────────────────────────────────────────────────

async function loadPresets() {
  presets = [];
  presetsLoaded = false;

  try {
    const url = `modules/${MODULE_ID}/presets/index.json`;
    const index = await foundry.utils.fetchJsonWithTimeout(url);
    for (const entry of index) {
      try {
        const presetUrl = `modules/${MODULE_ID}/presets/${entry.file}`;
        const data = await foundry.utils.fetchJsonWithTimeout(presetUrl);
        presets.push({
          id: entry.id,
          name: data.name || entry.id,
          description: data.description || "",
          group: entry.group || "custom",
          data
        });
      } catch (e) {
        console.warn(`${MODULE_TITLE} | Failed to load preset ${entry.file}`, e);
      }
    }
  } catch (e) {
    console.warn(`${MODULE_TITLE} | No presets index found`);
  }

  const userPresets = game.settings.get(MODULE_ID, "userPresets") ?? {};
  for (const [id, entry] of Object.entries(userPresets)) {
    presets.push({
      id,
      name: entry.name || id,
      description: entry.description || "",
      group: "custom",
      user: true,
      data: entry.state
    });
  }

  presetsLoaded = true;
  if (activeBuilder?.rendered) activeBuilder.render();
}

function applyPreset(presetId) {
  const preset = presets.find(p => p.id === presetId);
  if (!preset) return getDefaultState();

  const state = getDefaultState();
  foundry.utils.mergeObject(state, preset.data, {
    inplace: true,
    overwrite: true,
    insertKeys: true,
    insertValues: false
  });

  if (state.template.type !== undefined && !state.template.rows) {
    state.template.rows = [{
      id: foundry.utils.randomID(),
      type: state.template.type,
      distance: state.template.distance ?? "30",
      width: state.template.width ?? "",
      label: state.template.label ?? ""
    }];
    delete state.template.type;
    delete state.template.distance;
    delete state.template.width;
    delete state.template.label;
  }

  state.damage.rows = state.damage.rows.map(r => ({ ...r, id: foundry.utils.randomID() }));
  state.check.rows = state.check.rows.map(r => ({ ...r, id: foundry.utils.randomID() }));
  state.template.rows = state.template.rows.map(r => ({ ...r, id: foundry.utils.randomID() }));
  return state;
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "userPresets", {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  loadPresets();

  game.keybindings.register(MODULE_ID, "open-builder", {
    name: L("Keybinding.Name"),
    hint: L("Keybinding.Hint"),
    editable: [{ key: "KeyB", modifiers: ["Alt"] }],
    restricted: false,
    onDown: () => {
      openBuilder();
      return true;
    }
  });
});

Hooks.on("getSceneControlButtons", (controls) => {
  const tokenControls = controls.tokens ?? controls.token;
  if (!tokenControls) return;

  const tool = {
    name: "pf2e-quick-ability-builder",
    title: game.i18n.localize("PF2E_QUICK_ABILITY_BUILDER.Title"),
    icon: "fa-solid fa-wand-magic-sparkles",
    button: true,
    onClick: () => openBuilder()
  };

  if (Array.isArray(tokenControls.tools)) {
    if (!tokenControls.tools.some((t) => t.name === tool.name)) tokenControls.tools.push(tool);
  } else {
    tokenControls.tools ??= {};
    tokenControls.tools[tool.name] ??= tool;
  }
});

function openBuilder() {
  if (activeBuilder?.rendered) {
    activeBuilder.bringToFront();
    return;
  }

  activeBuilder = new QuickAbilityBuilder();
  activeBuilder.render(true);
}

// ─── Application ────────────────────────────────────────────────────────────

class QuickAbilityBuilder extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-app`,
    tag: "form",
    classes: ["pf2e-qab"],
    window: {
      title: MODULE_TITLE,
      icon: "fa-solid fa-wand-magic-sparkles",
      resizable: true
    },
    position: {
      width: 920,
      height: "auto"
    },
    form: {
      handler: QuickAbilityBuilder.#onSubmit,
      submitOnChange: false,
      closeOnSubmit: false
    }
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/builder.hbs`
    }
  };

  get title() {
    return game.i18n.localize("PF2E_QUICK_ABILITY_BUILDER.Title");
  }

  constructor(options = {}) {
    super(options);
    this.formState = getDefaultState();
    this.eventController = null;
    this.currentPresetId = null;
  }

  async _prepareContext(options) {
    const state = prepareTemplateState(this.formState);
    return {
      ...(await super._prepareContext(options)),
      state,
      presets,
      selectedPreset: this.currentPresetId ?? "",
      preview: buildMarkup(this.formState)
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.eventController?.abort();
    this.eventController = new AbortController();
    const { signal } = this.eventController;

    this.#syncModeVisibility();
    this.#syncFrequencyFields();

    this.element.addEventListener("input", () => this.#refreshPreview(), { signal });

    this.element.addEventListener("change", (event) => {
      const presetSelect = event.target.closest("[data-qab-action='preset']");
      if (presetSelect) {
        this.#onPresetChange(presetSelect.value);
        return;
      }
      if (event.target.closest("[data-qab-frequency]")) {
        this.#syncFrequencyFields();
      }
      this.#syncModeVisibility();
      this.#refreshPreview();
    }, { signal });

    this.element.addEventListener("click", (event) => this.#onClick(event), { signal });

    this.element.addEventListener("dragover", (event) => {
      const label = event.target.closest("[data-qab-drop]");
      if (label) {
        event.preventDefault();
        label.classList.add("qab-drag-over");
      }
    }, { signal });

    this.element.addEventListener("dragleave", (event) => {
      const label = event.target.closest("[data-qab-drop]");
      if (label && !label.contains(event.relatedTarget)) {
        label.classList.remove("qab-drag-over");
      }
    }, { signal });

    this.element.addEventListener("drop", (event) => {
      const label = event.target.closest("[data-qab-drop]");
      if (!label) return;
      event.preventDefault();
      label.classList.remove("qab-drag-over");
      const input = label.querySelector("input");
      if (!input) return;
      try {
        const raw = event.dataTransfer.getData("text/plain");
        const data = JSON.parse(raw);
        if (data.type === "Item" && data.uuid) {
          input.value = `@UUID[${data.uuid}]`;
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      } catch (e) {
        // not drag data we understand
      }
    }, { signal });
  }

  close(options) {
    this.eventController?.abort();
    if (activeBuilder === this) activeBuilder = null;
    return super.close(options);
  }

  #refreshPreview() {
    const preview = this.element.querySelector("[data-qab-preview]");
    if (!preview) return;
    preview.textContent = buildMarkup(this.#collectState());
  }

  #syncModeVisibility() {
    for (const row of this.element.querySelectorAll(".qab-row--check")) {
      const mode = row.querySelector("[data-qab-check-mode]")?.value ?? "dc";
      row.querySelector(".qab-dc-field")?.classList.toggle("qab-hidden", mode !== "dc");
      row.querySelector(".qab-defense-field")?.classList.toggle("qab-hidden", mode !== "defense");
      row.querySelector(".qab-against-field")?.classList.toggle("qab-hidden", mode !== "against");
    }
  }

  #syncFrequencyFields() {
    const freqSelect = this.element.querySelector("[data-qab-frequency]");
    const maxField = this.element.querySelector("[data-qab-frequency-max]");
    if (freqSelect && maxField) {
      maxField.classList.toggle("qab-hidden", !freqSelect.value);
    }
  }

  async #onPresetChange(presetId) {
    if (!presetId) return;
    this.currentPresetId = presetId;
    this.formState = applyPreset(presetId);
    await this.render();
    const preset = presets.find(p => p.id === presetId);
    if (preset) ui.notifications.info(LF("Notification.PresetLoaded", { name: preset.name }));
  }

  async #onClick(event) {
    const target = event.target.closest("[data-qab-action]");
    if (!target) return;

    event.preventDefault();

    switch (target.dataset.qabAction) {
      case "add-damage":
        this.formState = this.#collectState();
        this.formState.damage.rows.push(createDamageRow());
        this.render();
        break;
      case "remove-damage": {
        const id = target.closest("[data-row-id]")?.dataset.rowId;
        this.formState = this.#collectState();
        this.formState.damage.rows = this.formState.damage.rows.filter((row) => row.id !== id);
        this.render();
        break;
      }
      case "add-check":
        this.formState = this.#collectState();
        this.formState.check.rows.push(createCheckRow());
        this.render();
        break;
      case "remove-check": {
        const id = target.closest("[data-row-id]")?.dataset.rowId;
        this.formState = this.#collectState();
        this.formState.check.rows = this.formState.check.rows.filter((row) => row.id !== id);
        this.render();
        break;
      }
      case "add-template":
        this.formState = this.#collectState();
        this.formState.template.rows.push(createTemplateRow());
        this.render();
        break;
      case "remove-template": {
        const tplId = target.closest("[data-row-id]")?.dataset.rowId;
        this.formState = this.#collectState();
        this.formState.template.rows = this.formState.template.rows.filter((row) => row.id !== tplId);
        this.render();
        break;
      }
      case "save-preset":
        await this.#savePreset();
        break;
      case "delete-preset":
        await this.#deletePreset();
        break;
      case "copy":
        await this.#copy();
        break;
      case "post":
        await this.#post();
        break;
      case "create-action":
        await this.#createAction();
        break;
      case "reset":
        this.currentPresetId = null;
        this.formState = getDefaultState();
        this.render();
        break;
    }
  }

  #collectState() {
    const fd = new FormData(this.element);
    const next = getDefaultState();

    next.name = stringValue(fd, "name");
    next.description = stringValue(fd, "description");

    next.damage.areaDamage = fd.has("damage.areaDamage");
    next.damage.material = stringValue(fd, "damage.material");
    next.damage.sanctification = stringValue(fd, "damage.sanctification");
    next.damage.label = stringValue(fd, "damage.label");
    next.damage.extraTraits = csvValue(fd, "damage.extraTraits");

    next.check.showDC = stringValue(fd, "check.showDC") || "owner";
    next.check.secret = fd.has("check.secret");
    next.check.incapacitation = fd.has("check.incapacitation");
    next.check.immutable = fd.has("check.immutable");
    next.check.damagingEffect = fd.has("check.damagingEffect");
    next.check.breathWeapon = fd.has("check.breathWeapon");
    next.check.extraTraits = csvValue(fd, "check.extraTraits");
    next.check.extraOptions = csvValue(fd, "check.extraOptions");

    const templateCount = Number(fd.get("template.count") ?? 0);
    next.template.rows = Array.from({ length: templateCount }, (_, index) => ({
      id: stringValue(fd, `template.${index}.id`) || foundry.utils.randomID(),
      type: stringValue(fd, `template.${index}.type`),
      distance: stringValue(fd, `template.${index}.distance`) || "5",
      width: stringValue(fd, `template.${index}.width`),
      label: stringValue(fd, `template.${index}.label`)
    }));

    next.action.actions = stringValue(fd, "action.actions") || "1";
    next.action.category = stringValue(fd, "action.category") || "offensive";
    next.action.frequencyPer = normalizeFrequencyPer(stringValue(fd, "action.frequencyPer"));
    next.action.frequencyMax = stringValue(fd, "action.frequencyMax") || "1";

    next.effects.critSuccess = stringValue(fd, "effects.critSuccess");
    next.effects.success = stringValue(fd, "effects.success");
    next.effects.failure = stringValue(fd, "effects.failure");
    next.effects.critFailure = stringValue(fd, "effects.critFailure");

    const damageCount = Number(fd.get("damage.count") ?? 0);
    next.damage.rows = Array.from({ length: damageCount }, (_, index) => ({
      id: stringValue(fd, `damage.${index}.id`) || foundry.utils.randomID(),
      formula: stringValue(fd, `damage.${index}.formula`),
      type: stringValue(fd, `damage.${index}.type`) || "untyped",
      precision: fd.has(`damage.${index}.precision`),
      splash: fd.has(`damage.${index}.splash`),
      persistent: fd.has(`damage.${index}.persistent`),
      healing: fd.has(`damage.${index}.healing`)
    }));

    const checkCount = Number(fd.get("check.count") ?? 0);
    next.check.rows = Array.from({ length: checkCount }, (_, index) => ({
      id: stringValue(fd, `check.${index}.id`) || foundry.utils.randomID(),
      type: stringValue(fd, `check.${index}.type`) || "reflex",
      mode: stringValue(fd, `check.${index}.mode`) || "dc",
      dc: stringValue(fd, `check.${index}.dc`) || "20",
      defense: stringValue(fd, `check.${index}.defense`) || "ac",
      against: stringValue(fd, `check.${index}.against`) || "class-spell",
      basic: fd.has(`check.${index}.basic`),
      label: stringValue(fd, `check.${index}.label`)
    }));

    return next;
  }

  static #onSubmit(event, form, formData) {
    event.preventDefault();
  }

  async #savePreset() {
    const name = await Dialog.prompt({
      title: L("Preset.Save"),
      content: `<p>${L("Preset.SavePrompt")}</p>
        <input type="text" id="qab-preset-name" value="${this.formState.name}" style="width:100%">`,
      callback: (html) => {
        const el = html instanceof $ ? html[0] : html;
        return el?.querySelector("#qab-preset-name")?.value?.trim();
      },
      rejectClose: false
    });
    if (!name) return;
    const state = this.#collectState();
    const id = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const userPresets = game.settings.get(MODULE_ID, "userPresets") ?? {};
    userPresets[id] = { name, description: "", state };
    await game.settings.set(MODULE_ID, "userPresets", userPresets);
    await loadPresets();
    ui.notifications.info(LF("Notification.PresetSaved", { name }));
  }

  async #deletePreset() {
    const presetSelect = this.element.querySelector("[data-qab-action='preset']");
    const id = presetSelect?.value;
    if (!id) return;
    const userPresets = game.settings.get(MODULE_ID, "userPresets") ?? {};
    if (!userPresets[id]) {
      ui.notifications.warn(L("Preset.DeleteBuiltinWarn"));
      return;
    }
    const confirmed = await Dialog.confirm({
      title: L("Preset.Delete"),
      content: `<p>${LF("Preset.DeleteConfirm", { name: userPresets[id].name })}</p>`
    });
    if (!confirmed) return;
    delete userPresets[id];
    await game.settings.set(MODULE_ID, "userPresets", userPresets);
    this.currentPresetId = null;
    this.formState = getDefaultState();
    await loadPresets();
    ui.notifications.info(L("Notification.PresetDeleted"));
  }

  async #copy() {
    const content = buildMarkup(this.#collectState());
    const copied = await copyToClipboard(content);
    if (copied) ui.notifications.info(L("Notification.Copied"));
    else ui.notifications.warn(L("Notification.CopyFailed"));
  }

  async #post() {
    const content = buildMarkup(this.#collectState());
    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker()
    });
  }

  async #createAction() {
    const state = this.#collectState();
    const actor = getTargetActor();
    if (!actor) {
      ui.notifications.warn(L("Notification.SelectToken"));
      return;
    }

    if (!actor.isOwner) {
      ui.notifications.warn(LF("Notification.NoPermission", { actor: actor.name }));
      return;
    }

    const itemData = createActionItemData(state);
    try {
      await actor.createEmbeddedDocuments("Item", [itemData]);
      ui.notifications.info(LF("Notification.ActionCreated", { name: itemData.name, actor: actor.name }));
    } catch (error) {
      console.error(`${MODULE_TITLE} | Item creation failed`, error);
      ui.notifications.error(L("Notification.ActionFailed"));
    }
  }
}

// ─── State ──────────────────────────────────────────────────────────────────

function getDefaultState() {
  return {
    name: L("Defaults.Name"),
    description: L("Defaults.Description"),
    damage: {
      rows: [createDamageRow()],
      areaDamage: true,
      material: "",
      sanctification: "",
      label: "",
      extraTraits: []
    },
    check: {
      rows: [createCheckRow()],
      showDC: "owner",
      secret: false,
      incapacitation: false,
      immutable: false,
      damagingEffect: false,
      breathWeapon: true,
      extraTraits: [],
      extraOptions: []
    },
    template: {
      rows: [createTemplateRow()]
    },
    action: {
      actions: "1",
      category: "offensive",
      frequencyPer: "",
      frequencyMax: "1"
    },
    effects: {
      critSuccess: "",
      success: "",
      failure: "",
      critFailure: ""
    }
  };
}

function createDamageRow() {
  return {
    id: foundry.utils.randomID(),
    formula: "6d6",
    type: "fire",
    precision: false,
    splash: false,
    persistent: false,
    healing: false
  };
}

function createCheckRow() {
  return {
    id: foundry.utils.randomID(),
    type: "reflex",
    mode: "dc",
    dc: "20",
    defense: "ac",
    against: "class-spell",
    basic: true,
    label: ""
  };
}

function createTemplateRow() {
  return {
    id: foundry.utils.randomID(),
    type: "cone",
    distance: "30",
    width: "",
    label: ""
  };
}

function prepareTemplateState(state) {
  return {
    ...state,
    damage: {
      ...state.damage,
      rows: state.damage.rows.map((row) => ({
        ...row,
        damageTypes: markSelected(getDamageTypeOptions(), row.type)
      })),
      materials: markSelected([{ value: "", label: L("Damage.MaterialNone") }, ...getMaterialOptions()], state.damage.material),
      sanctifications: markSelected([
        { value: "", label: L("Damage.SanctificationNone") },
        { value: "holy", label: L("Damage.SanctificationHoly") },
        { value: "unholy", label: L("Damage.SanctificationUnholy") }
      ], state.damage.sanctification)
    },
    check: {
      ...state.check,
      rows: state.check.rows.map((row) => ({
        ...row,
        saves: markSelected(getSaveOptions(), row.type),
        skills: markSelected(getSkillOptions(), row.type),
        modes: markSelected([
          { value: "dc", label: L("Check.ModeDC") },
          { value: "defense", label: L("Check.ModeDefense") },
          { value: "against", label: L("Check.ModeAgainst") }
        ], row.mode),
        defenses: markSelected([
          { value: "ac", label: L("Defense.AC") },
          { value: "fortitude", label: L("Defense.Fortitude") },
          { value: "reflex", label: L("Defense.Reflex") },
          { value: "will", label: L("Defense.Will") },
          { value: "perception", label: L("Defense.Perception") }
        ], row.defense),
        againsts: markSelected([
          { value: "class-dc", label: L("Against.ClassDC") },
          { value: "spell-dc", label: L("Against.SpellDC") },
          { value: "class-spell", label: L("Against.ClassSpellDC") }
        ], row.against)
      })),
      showDCOptions: markSelected([
        { value: "owner", label: L("Check.ShowDCOwner") },
        { value: "gm", label: L("Check.ShowDCGM") },
        { value: "all", label: L("Check.ShowDCAll") },
        { value: "none", label: L("Check.ShowDCNone") }
      ], state.check.showDC)
    },
    template: {
      ...state.template,
      rows: state.template.rows.map((row) => ({
        ...row,
        types: markSelected([
          { value: "", label: L("Template.ShapeNone") },
          { value: "cone", label: L("Template.ShapeCone") },
          { value: "burst", label: L("Template.ShapeBurst") },
          { value: "emanation", label: L("Template.ShapeEmanation") },
          { value: "line", label: L("Template.ShapeLine") }
        ], row.type)
      }))
    },
    action: {
      ...state.action,
      frequencyOptions: getFrequencyOptions(state.action.frequencyPer)
    }
  };
}

function markSelected(options, selected) {
  return options.map((option) => ({
    ...option,
    selected: option.value === selected
  }));
}

const FREQUENCY_MAP = {
  "": "",
  round: "round",
  turn: "turn",
  minute: "PT1M",
  "10-minutes": "PT10M",
  hour: "PT1H",
  "24-hours": "PT24H",
  day: "day",
  week: "P1W",
  month: "P1M",
  year: "P1Y"
};

function normalizeFrequencyPer(value) {
  return FREQUENCY_MAP[value] ?? value;
}

function getFrequencyOptions(selected) {
  const options = [
    { value: "", label: L("Action.FrequencyAtWill") },
    { value: "round", label: L("Action.FrequencyRound") },
    { value: "turn", label: L("Action.FrequencyTurn") },
    { value: "PT1M", label: L("Action.FrequencyMinute") },
    { value: "PT10M", label: L("Action.Frequency10Minutes") },
    { value: "PT1H", label: L("Action.FrequencyHour") },
    { value: "PT24H", label: L("Action.Frequency24Hours") },
    { value: "day", label: L("Action.FrequencyDay") },
    { value: "P1W", label: L("Action.FrequencyWeek") },
    { value: "P1M", label: L("Action.FrequencyMonth") },
    { value: "P1Y", label: L("Action.FrequencyYear") }
  ];
  return markSelected(options, selected);
}

// ─── Markup ─────────────────────────────────────────────────────────────────

function buildMarkup(state) {
  const blocks = [];
  if (state.name) blocks.push(`<h3>${escapeHtml(state.name)}</h3>`);
  if (state.description) blocks.push(`<p>${escapeHtml(state.description)}</p>`);

  const damage = buildDamageLink(state);
  if (damage) blocks.push(`<p>${damage}</p>`);

  for (const check of state.check.rows) {
    const link = buildCheckLink(check, state.check);
    if (link) blocks.push(`<p>${link}</p>`);
  }

  for (const tpl of state.template.rows) {
    const link = buildTemplateLink(tpl);
    if (link) blocks.push(`<p>${link}</p>`);
  }

  const effects = buildEffectsBlock(state.effects);
  if (effects) blocks.push(effects);

  return blocks.join("\n");
}

function buildEffectsBlock(effects) {
  const items = [];
  if (effects.critSuccess) items.push(`<p><strong>${L("EffectResult.CritSuccess")}:</strong> ${toUuidLink(effects.critSuccess)}</p>`);
  if (effects.success) items.push(`<p><strong>${L("EffectResult.Success")}:</strong> ${toUuidLink(effects.success)}</p>`);
  if (effects.failure) items.push(`<p><strong>${L("EffectResult.Failure")}:</strong> ${toUuidLink(effects.failure)}</p>`);
  if (effects.critFailure) items.push(`<p><strong>${L("EffectResult.CritFailure")}:</strong> ${toUuidLink(effects.critFailure)}</p>`);
  return items.length ? items.join("\n") : "";
}

function toUuidLink(value) {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed.startsWith("@UUID[")) return trimmed;
  const labelMatch = trimmed.match(/^(.+)\{(.+)\}$/);
  if (labelMatch) return `@UUID[${labelMatch[1].trim()}]{${labelMatch[2].trim()}}`;
  return `@UUID[${trimmed}]`;
}

function createActionItemData(state) {
  const content = buildMarkup(state);

  const traits = dedupe([
    ...state.damage.extraTraits,
    ...state.check.extraTraits,
    state.damage.sanctification
  ]);

  const itemData = {
    name: state.name || L("Defaults.ActionName"),
    type: "action",
    img: "icons/svg/dice-target.svg",
    system: {
      description: { value: content },
      actionType: { value: getActionTypeValue(state.action.actions) },
      actions: { value: getActionValue(state.action.actions) },
      category: state.action.category || "offensive",
      traits: { value: traits }
    },
    flags: {
      [MODULE_ID]: { createdBy: MODULE_ID }
    }
  };

  if (state.action.frequencyPer) {
    itemData.system.frequency = {
      value: 0,
      max: parseInt(state.action.frequencyMax) || 1,
      per: state.action.frequencyPer
    };
  }

  return itemData;
}

function getActionTypeValue(actions) {
  if (actions === "free") return "free";
  if (actions === "reaction") return "reaction";
  if (actions === "passive") return "passive";
  return "action";
}

function getActionValue(actions) {
  if (actions === "free" || actions === "reaction" || actions === "passive") return null;
  return parseInt(actions) || 1;
}

function getTargetActor() {
  const controlled = canvas.tokens?.controlled
    ?.map((token) => token.actor)
    .find((actor) => actor?.isOwner);
  return controlled ?? game.user.character ?? null;
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
    console.warn(`${MODULE_TITLE} | Clipboard API failed`, error);
  }
  return copyToClipboardFallback(text);
}

function copyToClipboardFallback(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.left = "-1000px";
  document.body.append(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch (error) {
    console.warn(`${MODULE_TITLE} | Clipboard fallback failed`, error);
    return false;
  } finally {
    textarea.remove();
  }
}

function buildDamageLink(state) {
  const parts = state.damage.rows.flatMap((row) => {
    const formula = row.formula.trim();
    if (!formula) return [];

    const innerTraits = [];
    if (row.precision) innerTraits.push("precision");
    if (row.splash) innerTraits.push("splash");

    const outerTraits = [];
    if (row.persistent) outerTraits.push("persistent");
    if (row.healing) outerTraits.push("healing");
    if (row.type && row.type !== "untyped") outerTraits.push(row.type);

    let term = formula;
    if (innerTraits.length) term = `(${term}[${innerTraits.join(",")}])`;
    if (outerTraits.length) term = `${term}[${outerTraits.join(",")}]`;
    return [term];
  });

  if (!parts.length) return "";

  const params = [];
  const options = [];
  if (state.damage.areaDamage) options.push("area-damage");
  if (state.damage.material) options.push(`damage:material:${state.damage.material}`);
  if (options.length) params.push(`options:${options.join(",")}`);

  const traits = [];
  if (state.damage.sanctification) traits.push(state.damage.sanctification);
  traits.push(...state.damage.extraTraits);
  if (traits.length) params.push(`traits:${dedupe(traits).join(",")}`);

  const suffix = params.length ? `|${params.join("|")}` : "";
  const label = state.damage.label ? `{${escapeCurlyLabel(state.damage.label)}}` : "";
  return `@Damage[${parts.join(",")}${suffix}]${label}`;
}

function buildCheckLink(row, shared) {
  if (!row.type) return "";

  const params = [row.type];
  if (row.mode === "defense") params.push(`defense:${row.defense}`);
  else if (row.mode === "against") params.push(`against:${row.against}`);
  else params.push(`dc:${row.dc || "20"}`);

  if (row.basic) params.push("basic");
  if (shared.showDC && shared.showDC !== "owner") params.push(`showDC:${shared.showDC}`);
  if (shared.immutable) params.push("immutable");

  const traits = [];
  if (shared.secret) traits.push("secret");
  if (shared.incapacitation) traits.push("incapacitation");
  traits.push(...shared.extraTraits);
  if (traits.length) params.push(`traits:${dedupe(traits).join(",")}`);

  const options = [];
  if (shared.damagingEffect) options.push("damaging-effect");
  if (shared.breathWeapon) options.push("action:breath-weapon");
  options.push(...shared.extraOptions);
  if (options.length) params.push(`options:${dedupe(options).join(",")}`);

  const label = row.label ? `{${escapeCurlyLabel(row.label)}}` : "";
  return `@Check[${params.join("|")}]${label}`;
}

function buildTemplateLink(template) {
  if (!template.type) return "";

  const params = [`type:${template.type}`, `distance:${template.distance || "5"}`];
  if (template.type === "line" && template.width) params.push(`width:${template.width}`);

  const label = template.label ? `{${escapeCurlyLabel(template.label)}}` : "";
  return `@Template[${params.join("|")}]${label}`;
}

function getDamageTypeOptions() {
  const configured = game.pf2e?.damageTypes ?? CONFIG.PF2E?.damageTypes ?? {};
  const preferred = [
    "untyped", "bludgeoning", "piercing", "slashing", "bleed",
    "acid", "cold", "electricity", "fire", "force", "sonic",
    "spirit", "vitality", "void", "mental", "poison"
  ];
  const all = dedupe([...preferred, ...Object.keys(configured).sort()]);
  return all.map((value) => ({ value, label: localize(configured[value] ?? value) }));
}

function getMaterialOptions() {
  const configured = CONFIG.PF2E?.materialDamageEffects ?? {};
  const preferred = ["silver", "cold-iron", "adamantine"];
  const all = dedupe([...preferred, ...Object.keys(configured).sort()]);
  return all.map((value) => ({ value, label: localize(configured[value] ?? value) }));
}

function getSaveOptions() {
  return [
    { value: "flat", label: L("Save.Flat") },
    { value: "perception", label: L("Save.Perception") },
    { value: "fortitude", label: L("Save.Fortitude") },
    { value: "reflex", label: L("Save.Reflex") },
    { value: "will", label: L("Save.Will") }
  ];
}

function getSkillOptions() {
  return Object.entries(CONFIG.PF2E?.skills ?? {})
    .sort(([, a], [, b]) => localize(a.label).localeCompare(localize(b.label), game.i18n.lang))
    .map(([value, data]) => ({ value, label: localize(data.label) }));
}

function stringValue(formData, key) {
  return String(formData.get(key) ?? "").trim();
}

function csvValue(formData, key) {
  return stringValue(formData, key)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

function localize(value) {
  if (!value) return "";
  return game.i18n.localize(value) || value;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function escapeCurlyLabel(value) {
  return value.replace(/[{}]/g, "").trim();
}
