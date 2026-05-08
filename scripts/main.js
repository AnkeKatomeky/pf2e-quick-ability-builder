const MODULE_ID = "pf2e-quick-ability-builder";
const MODULE_TITLE = "PF2e Quick Ability Builder";

let activeBuilder;

Hooks.once("init", () => {
  game.keybindings.register(MODULE_ID, "open-builder", {
    name: `${MODULE_TITLE}: открыть конструктор`,
    hint: "Открывает окно для быстрого создания @Damage, @Check и @Template.",
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
    title: MODULE_TITLE,
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

  constructor(options = {}) {
    super(options);
    this.formState = getDefaultState();
    this.eventController = null;
  }

  async _prepareContext(options) {
    const state = prepareTemplateState(this.formState);
    return {
      ...(await super._prepareContext(options)),
      state,
      preview: buildMarkup(this.formState)
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.eventController?.abort();
    this.eventController = new AbortController();
    const { signal } = this.eventController;

    this.#syncModeVisibility();
    this.element.addEventListener("input", () => this.#refreshPreview(), { signal });
    this.element.addEventListener("change", () => {
      this.#syncModeVisibility();
      this.#refreshPreview();
    }, { signal });
    this.element.addEventListener("click", (event) => this.#onClick(event), { signal });
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
    next.template.type = stringValue(fd, "template.type");
    next.template.distance = stringValue(fd, "template.distance");
    next.template.width = stringValue(fd, "template.width");
    next.template.label = stringValue(fd, "template.label");

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

  async #copy() {
    const content = buildMarkup(this.#collectState());

    const copied = await copyToClipboard(content);
    if (copied) ui.notifications.info("Скопировано в буфер обмена.");
    else ui.notifications.warn("Не удалось скопировать автоматически. Текст можно взять из предпросмотра.");
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
      ui.notifications.warn("Выберите свой токен или назначьте персонажа пользователю.");
      return;
    }

    if (!actor.isOwner) {
      ui.notifications.warn(`Нет прав на создание действия у актера "${actor.name}".`);
      return;
    }

    const itemData = createActionItemData(state);
    try {
      await actor.createEmbeddedDocuments("Item", [itemData]);
      ui.notifications.info(`Действие "${itemData.name}" создано у ${actor.name}.`);
    } catch (error) {
      console.error(`${MODULE_TITLE} | Action creation failed`, error);
      ui.notifications.error("Не удалось создать действие. Проверь права на актера и тип листа.");
    }
  }
}

function getDefaultState() {
  return {
    name: "Огненное дыхание",
    description: "Существо выдыхает пламя в области.",
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
      type: "cone",
      distance: "30",
      width: "",
      label: ""
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

function prepareTemplateState(state) {
  return {
    ...state,
    damage: {
      ...state.damage,
      rows: state.damage.rows.map((row) => ({
        ...row,
        damageTypes: markSelected(getDamageTypeOptions(), row.type)
      })),
      materials: markSelected([{ value: "", label: "Без материала" }, ...getMaterialOptions()], state.damage.material),
      sanctifications: markSelected([
        { value: "", label: "Без освящения" },
        { value: "holy", label: "Святой" },
        { value: "unholy", label: "Нечестивый" }
      ], state.damage.sanctification)
    },
    check: {
      ...state.check,
      rows: state.check.rows.map((row) => ({
        ...row,
        saves: markSelected(getSaveOptions(), row.type),
        skills: markSelected(getSkillOptions(), row.type),
        modes: markSelected([
          { value: "dc", label: "DC" },
          { value: "defense", label: "Против защиты" },
          { value: "against", label: "Против DC цели" }
        ], row.mode),
        defenses: markSelected([
          { value: "ac", label: "AC" },
          { value: "fortitude", label: "Стойкость" },
          { value: "reflex", label: "Рефлекс" },
          { value: "will", label: "Воля" },
          { value: "perception", label: "Восприятие" }
        ], row.defense),
        againsts: markSelected([
          { value: "class-dc", label: "Class DC" },
          { value: "spell-dc", label: "Spell DC" },
          { value: "class-spell", label: "Class/Spell DC" }
        ], row.against)
      })),
      showDCOptions: markSelected([
        { value: "owner", label: "Владелец" },
        { value: "gm", label: "ГМ" },
        { value: "all", label: "Все" },
        { value: "none", label: "Никто" }
      ], state.check.showDC)
    },
    template: {
      ...state.template,
      types: markSelected([
        { value: "", label: "Без шаблона" },
        { value: "cone", label: "Конус" },
        { value: "burst", label: "Взрыв" },
        { value: "emanation", label: "Эманация" },
        { value: "line", label: "Линия" }
      ], state.template.type)
    }
  };
}

function markSelected(options, selected) {
  return options.map((option) => ({
    ...option,
    selected: option.value === selected
  }));
}

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

  const template = buildTemplateLink(state.template);
  if (template) blocks.push(`<p>${template}</p>`);

  return blocks.join("\n");
}

function createActionItemData(state) {
  const content = buildMarkup(state);
  return {
    name: state.name || "Быстрое действие",
    type: "action",
    img: "icons/svg/dice-target.svg",
    system: {
      description: {
        value: content
      },
      actionType: {
        value: "action"
      },
      actions: {
        value: 1
      },
      category: "offensive",
      traits: {
        value: dedupe([
          ...state.damage.extraTraits,
          ...state.check.extraTraits,
          state.damage.sanctification
        ])
      }
    },
    flags: {
      [MODULE_ID]: {
        createdBy: MODULE_ID
      }
    }
  };
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
    "untyped",
    "bludgeoning",
    "piercing",
    "slashing",
    "bleed",
    "acid",
    "cold",
    "electricity",
    "fire",
    "force",
    "sonic",
    "spirit",
    "vitality",
    "void",
    "mental",
    "poison"
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
    { value: "flat", label: "Чистая проверка" },
    { value: "perception", label: localize("PF2E.PerceptionLabel") },
    { value: "fortitude", label: localize(CONFIG.PF2E?.saves?.fortitude ?? "Стойкость") },
    { value: "reflex", label: localize(CONFIG.PF2E?.saves?.reflex ?? "Рефлекс") },
    { value: "will", label: localize(CONFIG.PF2E?.saves?.will ?? "Воля") }
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
