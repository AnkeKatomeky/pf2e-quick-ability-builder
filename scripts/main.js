// PF2e Quick Ability Builder — ИСПРАВЛЕННЫЙ ДИЗАЙН (v13 + PF2e) — с defense/against

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;
  let tokenTools = controls.tokens || controls.token;
  if (!tokenTools) return;
  const tool = {
    name: "pf2e-quick-builder",
    title: "PF2e Quick Ability Builder",
    icon: "fas fa-wand-magic-sparkles",
    button: true,
    onClick: () => openBuilder()
  };
  if (Array.isArray(tokenTools.tools)) {
    tokenTools.tools.push(tool);
  } else {
    tokenTools.tools ??= {};
    tokenTools.tools["pf2e-quick-builder"] = tool;
  }
});

function openBuilder() {
  const damageTypesObj = game.pf2e?.damageTypes || CONFIG.PF2E?.damageTypes || {};

  const physical = ['piercing', 'slashing', 'bludgeoning', 'bleed'];
  const energy = ['fire', 'cold', 'electricity', 'force'];
  const natural = ['acid', 'poison', 'sonic', 'mental'];
  const planar = ['spirit', 'vitality', 'void'];

  const sortedDamageKeys = ['untyped', ...physical, ...energy, ...natural, ...planar];

  const damageTypesHTML = sortedDamageKeys.map(k => `<option value="${k}">${game.i18n.localize(damageTypesObj[k] || k)}</option>`).join('');

  const materialObj = CONFIG.PF2E?.materialDamageEffects || {};
  const preferredMaterials = ['silver', 'cold-iron', 'adamantine'];
  const otherMaterials = Object.keys(materialObj).filter(k => !preferredMaterials.includes(k)).sort();
  const sortedMaterialKeys = [...preferredMaterials, ...otherMaterials];

  const materialHTML = '<option value="">— Без материала —</option>' +
    sortedMaterialKeys.map(k => `<option value="${k}">${game.i18n.localize(materialObj[k])}</option>`).join('');

  const saveTypes = ['fortitude', 'reflex', 'will', 'perception'];
  const saveHTML = saveTypes.map(s => {
    let label;
    if (s === 'perception') {
      label = game.i18n.localize("PF2E.PerceptionLabel") || "Восприятие";
    } else {
      label = game.i18n.localize(CONFIG.PF2E.saves?.[s] || s);
    }
    return `<option value="${s}">${label}</option>`;
  }).join('');

  const skillHTML = Object.entries(CONFIG.PF2E?.skills || {})
    .map(([k, v]) => `<option value="${k}">${game.i18n.localize(v.label)}</option>`).join('');

  const html = `
    <style>
      :root {
        --qab-danger: #800000ff;
        --qab-danger-dark: #730000ff;
        
        /* === ЗДЕСЬ МЕНЯЙ ШИРИНЫ САМ (пиксели) === */
        --check-type-width:  50%;      /* первый селект "Проверка:" */
        --mode-width:        30%;     /* "Обычный КС / Против защиты / Против DC" */
        --defense-width:     180px;     /* селекты AC, Стойкость, Class DC и т.д. */
        --dc-input-width:    140px;      /* поле ввода числа КС */
      }
      
      input[type="checkbox"]:checked { accent-color: var(--qab-danger); }
      
      .qab-damage-group {
        border: 4px solid #80000070;
        border-radius: 6px;
        background: rgba(0,0,0,0.05);
        padding: 12px;
        margin-bottom: 12px;
      }
      
      .qab-dmg-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        padding: 12px 145px 12px 12px;   /* отступ справа под кнопку "Удалить" */
        border: 4px solid #80000070;
        border-radius: 4px;
        margin-bottom: 8px;
        position: relative;
      }
      
      .qab-check-type   { min-width: var(--check-type-width); }
      .qab-mode         { min-width: var(--mode-width); }
      .qab-defense-select,
      .qab-against-select { min-width: var(--defense-width); }
      .qab-check-dc     { width: var(--dc-input-width); }
      
      .qab-dc-label {
        padding: 0 4px;
        white-space: nowrap;
        font-weight: 500;
      }
      
      .qab-basic-label {
        margin-left: 6px;
        flex-shrink: 0;
      }
      
      .qab-rem {
        position: absolute !important;
        top: 50%;
        transform: translateY(-50%);
        right: 12px;
        width: auto !important;
        min-width: 80px;
        background: var(--qab-danger) !important;
        color: white !important;
        border: 1px solid var(--qab-danger-dark) !important;
        padding: 6px 18px !important;
        border-radius: 4px !important;
        cursor: pointer !important;
        font-size: 0.85em !important;
        white-space: nowrap;
        z-index: 10;
      }
      .qab-rem:hover { background: var(--qab-danger-dark) !important; }
      
      #add-dmg, #add-check {
        background: #80000020 !important;
        border: 2px solid #80000070 !important;
        color: #800000ff !important;
        font-weight: 500;
      }
      #add-dmg:hover, #add-check:hover { background: #80000040 !important; }
      
      #post {
        background: var(--qab-danger) !important;
        border-color: var(--qab-danger-dark) !important;
        color: white;
      }
      #post:hover { background: var(--qab-danger-dark) !important; }
    </style>

    
    <div class="form-group qab-damage-group">
      <div class="form-group">
      <label style="font-weight:bold">Название способности</label>
      <input id="name" style="width:100%" value="Огненное дыхание">
      </div>
      
      <div class="form-group">
      <label>Краткое описание</label>
      <textarea id="desc" rows="2" style="width:100%; resize: vertical;">Существо выдыхает пламя в конусе 30 футов.</textarea>
      </div>
    </div>
    
    <div class="form-group qab-damage-group">
      <label style="font-weight:bold">Урон (можно несколько частей)</label>
      <div id="damages"></div>
      <button id="add-dmg" class="btn" style="width:100%; margin-top: 8px;">+ Добавить часть урона</button>
      <div style="margin-top: 8px;">
        <label style="white-space: nowrap;"><input type="checkbox" id="area-dmg"> По области (area-damage)</label>
      </div>
      <div class="form-group" style="margin-top: 8px;">
        <label>Материал (опционально)</label>
        <select id="material" style="width:100%;">
          ${materialHTML}
        </select>
      </div>
      <div class="form-group" style="margin-top: 8px;">
        <label>Освящение (опционально)</label>
        <select id="sanct" style="width:100%;">
          <option value="">— Без освящения —</option>
          <option value="holy">Святой</option>
          <option value="unholy">Нечестивый</option>
        </select>
      </div>
      <div class="form-group" style="margin-top: 8px;">
        <label>Дополнительные трейты (через запятую, опционально)</label>
        <input id="extra-traits" placeholder="fire,evocation" style="width:100%">
      </div>
    </div>

    <div class="form-group qab-damage-group">
      <label style="font-weight:bold">Проверка / Спасбросок (можно несколько)</label>
      <div id="checks"></div>
      <button id="add-check" class="btn" style="width:100%; margin-top: 8px;">+ Добавить проверку</button>
      
      <div class="form-group" style="margin-top: 12px;">
        <label>Показывать КС</label>
        <select id="showDC" style="width:100%;">
          <option value="owner" selected>Владелец</option>
          <option value="gm">ГМ</option>
          <option value="all">Все</option>
          <option value="none">Никто</option>
        </select>
      </div>
      <div class="form-group" style="margin-top: 8px;">
        <label>Теги</label>
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <label style="white-space: nowrap;"><input type="checkbox" id="trait-secret" title="Не показывать результат игроку"> Секрет</label>
          <label style="white-space: nowrap;"><input type="checkbox" id="trait-incap" title="Корректировка успеха если применяется к более сильному противнику"> Недееспособность</label>
          <input id="traits-check" placeholder="poison,death" style="flex:1; min-width:150px;">
        </div>
      </div>
      <div class="form-group" style="margin-top: 8px;">
        <label>Опции</label>
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <label style="white-space: nowrap;"><input type="checkbox" id="immutable" title="Не применять Элитные/Слабые корректировки или корректировки от статус эфектов"> Неизменный</label>
          <label style="white-space: nowrap;"><input type="checkbox" id="opt-damaging" title="Автоматически применяется если это простой спасбросок"> Наносящий урон</label>
          <label style="white-space: nowrap;"><input type="checkbox" id="opt-breath"> Атака дыханием</label>
          <input id="options-check" placeholder="action:custom-action" style="flex:1; min-width:150px;">
        </div>
      </div>
    </div>

    <div class="form-group qab-damage-group">
      <label style="font-weight:bold">Шаблон области</label>
      <div class="form-fields">
        <select id="t-type">
          <option value="" selected>— Без шаблона —</option>
          <option value="cone">Конус</option>
          <option value="burst">Взрыв</option>
          <option value="emanation">Эманация</option>
          <option value="line">Линия</option>
        </select>
        <span style="padding:0 8px">Дистанция (футы):</span>
        <input id="t-dist" type="number" value="30" style="width:80px">
      </div>
    </div>

    <div style="margin-top:20px; display:flex; gap:10px; justify-content:flex-end;">
      <button id="copy" class="btn">Копировать в буфер</button>
      <button id="post" class="btn btn-primary">Отправить в чат</button>
    </div>
  `;

  new Dialog({
    title: "⚡ PF2e Quick Ability Builder",
    content: html,
    buttons: {},
    render: (html) => {
      const $damages = html.find("#damages");
      const addRow = () => {
        const row = $(`
          <div class="qab-dmg-row">
            <span style="padding:0 8px; white-space:nowrap;">Формула урона:</span>
            <input type="text" class="qab-formula" value="6d6" placeholder="6d6" style="width:110px;">
            <span style="padding:0 8px; white-space:nowrap;">Тип урона:</span>
            <select class="qab-dmg-type">${damageTypesHTML}</select>
            <div class="qab-traits">
              <label><input type="checkbox" class="qab-prec">Точный</label>
              <label><input type="checkbox" class="qab-splash">Брызги</label>
              <label><input type="checkbox" class="qab-pers">Периодический</label>
              <label><input type="checkbox" class="qab-heal">Исцеление</label>
            </div>
            <button class="qab-rem">Удалить</button>
          </div>
        `);
        $damages.append(row);
        row.find(".qab-rem").click(() => row.remove());
      };
      html.find("#add-dmg").click(addRow);
      addRow();

      // ==================== ПРОВЕРКИ С РЕЖИМОМ КС ====================
      const $checks = html.find("#checks");

      const addCheckRow = () => {
        const row = $(`
          <div class="qab-dmg-row qab-check-row">
            <span style="padding:0 8px; white-space:nowrap; font-weight:500; min-width:78px;">Проверка:</span>
            <select class="qab-check-type">
              <option value="flat" selected>Чистая проверка</option>
              ${saveHTML}
              <optgroup label="Навыки">
                ${skillHTML}
              </optgroup>
            </select>

            <select class="qab-mode">
              <option value="dc" selected>Обычный КС</option>
              <option value="defense">Против защиты</option>
              <option value="against">Против КС</option>
            </select>

            <span class="qab-dc-label" style="padding:0 6px; white-space:nowrap; font-weight:500;">КС:</span>
            <input type="number" class="qab-check-dc" value="15">

            <select class="qab-defense-select" style="display:none;">
              <option value="ac">КБ</option>
              <option value="fortitude">Стойкость</option>
              <option value="reflex">Рефлекс</option>
              <option value="will">Воля</option>
              <option value="perception">Восприятие</option>
            </select>

            <select class="qab-against-select" style="display:none;">
              <option value="class-dc">КС Класса</option>
              <option value="spell-dc">КС Заклинаний</option>
              <option value="class-spell">КС Класса/Заклинаний</option>
            </select>

            <label class="qab-basic-label" style="white-space:nowrap; display:none;">
              <input type="checkbox" class="qab-basic" checked> Простой
            </label>
            
            <button class="qab-rem">Удалить</button>
          </div>
        `);
        $checks.append(row);

        const $mode = row.find(".qab-mode");
        const $dcLabel = row.find(".qab-dc-label");
        const $dcInput = row.find(".qab-check-dc");
        const $defenseSel = row.find(".qab-defense-select");
        const $againstSel = row.find(".qab-against-select");
        const $basicLabel = row.find(".qab-basic-label");
        const $type = row.find(".qab-check-type");

        const updateMode = () => {
          const mode = $mode.val();
          $dcLabel.toggle(mode === "dc");
          $dcInput.toggle(mode === "dc");
          $defenseSel.toggle(mode === "defense");
          $againstSel.toggle(mode === "against");

          const isSave = ['fortitude', 'reflex', 'will'].includes($type.val());
          $basicLabel.toggle(isSave);
        };

        $mode.on("change", updateMode);
        $type.on("change", updateMode);
        updateMode();

        row.find(".qab-rem").click(() => row.remove());
      };

      html.find("#add-check").click(addCheckRow);
      addCheckRow();

      const build = () => {
        let out = `<h3>${html.find("#name").val()}</h3><p>${html.find("#desc").val()}</p>`;

        // УРОН
        const parts = [];
        $damages.find(".qab-dmg-row").each((_, el) => {
          const $r = $(el);
          const f = $r.find(".qab-formula").val().trim();
          if (!f) return;
          const t = $r.find(".qab-dmg-type").val();

          const inner = [];
          if ($r.find(".qab-prec").is(":checked")) inner.push("precision");
          if ($r.find(".qab-splash").is(":checked")) inner.push("splash");

          const outer = [];
          if ($r.find(".qab-pers").is(":checked")) outer.push("persistent");
          if ($r.find(".qab-heal").is(":checked")) outer.push("healing");
          if (t && t !== 'untyped') outer.push(t);

          let term = f;
          if (inner.length) { term += `[${inner.join(",")}]`; term = `(${term})`; }
          if (outer.length) term += `[${outer.join(",")}]`;

          parts.push(term);
        });
        if (parts.length) {
          const hasArea = html.find("#area-dmg").is(":checked");
          let opt = [];
          if (hasArea) opt.push("area-damage");
          const m = html.find("#material").val();
          if (m) opt.push(`damage:material:${m}`);
          const optStr = opt.length ? `|options:${opt.join(",")}` : "";

          let tr = [];
          const s = html.find("#sanct").val();
          if (s) tr.push(s);
          const extra = html.find("#extra-traits").val().trim();
          if (extra) tr.push(...extra.split(",").map(t => t.trim()).filter(Boolean));
          const traitStr = tr.length ? `|traits:${tr.join(",")}` : "";

          out += `<p>@Damage[${parts.join(",")}${optStr}${traitStr}]</p>`;
        }

        // ПРОВЕРКИ
        $checks.find(".qab-dmg-row").each((_, el) => {
          const $r = $(el);
          const type = $r.find(".qab-check-type").val().trim();
          if (!type) return;

          const mode = $r.find(".qab-mode").val();
          let c = `@Check[${type}`;

          if (mode === "dc") {
            const dcVal = $r.find(".qab-check-dc").val() || "25";
            c += `|dc:${dcVal}`;
          } else if (mode === "defense") {
            c += `|defense:${$r.find(".qab-defense-select").val()}`;
          } else if (mode === "against") {
            c += `|against:${$r.find(".qab-against-select").val()}`;
          }

          if ($r.find(".qab-basic").is(":checked")) c += "|basic:true";

          const show = html.find("#showDC").val();
          if (show !== "owner") c += `|showDC:${show}`;
          if (html.find("#immutable").is(":checked")) c += "|immutable:true";

          let traitsList = [];
          if (html.find("#trait-secret").is(":checked")) traitsList.push("secret");
          if (html.find("#trait-incap").is(":checked")) traitsList.push("incapacitation");
          const extraTraits = html.find("#traits-check").val().trim();
          if (extraTraits) traitsList.push(...extraTraits.split(",").map(t => t.trim()).filter(Boolean));
          if (traitsList.length) c += `|traits:${traitsList.join(",")}`;

          let optionsList = [];
          if (html.find("#opt-damaging").is(":checked")) optionsList.push("damaging-effect");
          if (html.find("#opt-breath").is(":checked")) optionsList.push("action:breath-weapon");
          const extraOptions = html.find("#options-check").val().trim();
          if (extraOptions) optionsList.push(...extraOptions.split(",").map(t => t.trim()).filter(Boolean));
          optionsList = [...new Set(optionsList)];
          if (optionsList.length) c += `|options:${optionsList.join(",")}`;

          c += "]";
          out += `<p>${c}</p>`;
        });

        // ШАБЛОН
        const tt = html.find("#t-type").val();
        const td = html.find("#t-dist").val();
        if (tt) out += `<p>@Template[type:${tt}|distance:${td}]</p>`;
        return out;
      };

      html.find("#post").click(() => {
        ChatMessage.create({ content: build(), speaker: ChatMessage.getSpeaker() });
      });
      html.find("#copy").click(() => {
        navigator.clipboard.writeText(build()).then(() =>
          ui.notifications.info("✅ Скопировано! Вставляй в описание способности.")
        );
      });
    }
  }, { width: 820 }).render(true);
}