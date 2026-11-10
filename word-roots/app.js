(function () {
  "use strict";

  const KEY = "word-roots-progress-v1";
  let speechOK = typeof window.speechSynthesis !== "undefined" && typeof window.SpeechSynthesisUtterance === "function";

  let families = [];
  let progress = loadProgress();
  let lastFamilyId = null;
  let shelf = "4";
  let volume = "a";
  let booksReady = false;
  const starLegends = {};
  const gradeName = { "3": "三年级", "4": "四年级", "5": "五年级", "6": "六年级" };
  const BOOK_CODES = ["3A", "3B", "4A", "4B", "5A", "6A"];
  const EXPECTED = {
    "3A": [144, 46],
    "3B": [82, 37],
    "4A": [102, 47],
    "4B": [134, 115],
    "5A": [99, 128],
    "6A": [79, 117]
  };

  loadBooks().then(function (books) {
    const seen = new Set();
    books.forEach(function (book) { mountBook(book, seen); });
    booksReady = true;
  }).catch(function (err) {
    console.error(err);
    booksReady = false;
  }).then(function () {
    try {
      init();
    } catch (err) {
      document.documentElement.classList.remove("js");
      console.error(err);
    }
  });

  function init() {
    families = parseFamilies();
    if (!families.length) throw new Error("no families");
    updateProgressUI();
    document.querySelectorAll("[data-tab]").forEach(bindTab);
    document.querySelectorAll("[data-shelf-pick]").forEach(function (tab) {
      bindChoice(tab, "data-shelf-pick", function (value) { shelf = value; });
    });
    document.querySelectorAll("[data-volume-pick]").forEach(function (tab) {
      bindChoice(tab, "data-volume-pick", function (value) { volume = value; });
    });
    const host = document.querySelector("[data-hero-speak]");
    if (host) {
      const button = speakButton(host.getAttribute("data-hero-speak"));
      if (button) host.replaceWith(button);
      else host.remove();
    }
    window.addEventListener("hashchange", function () {
      render();
    });
    render();
  }

  function parseFamilies() {
    return Array.from(document.querySelectorAll(".family")).map(function (el) {
      const members = Array.from(el.querySelectorAll(".study li")).map(function (li) {
        return {
          en: li.dataset.en || "",
          zh: li.dataset.zh || "",
          parts: (li.dataset.parts || "").split("|").filter(Boolean),
          partZh: (li.dataset.partzh || "").split("|").filter(Boolean),
          unit: li.dataset.unit || "",
          note: li.dataset.note || "",
          pos: li.dataset.pos || "",
          ipa: li.dataset.ipa || "",
          star: li.dataset.star === "true",
          item: li.dataset.item || "word",
          li: li
        };
      });
      return {
        id: el.id,
        kind: el.dataset.kind || "compound",
        pattern: el.dataset.pattern || "",
        sound: el.dataset.sound || "",
        shelf: el.dataset.shelf || "review",
        volume: el.dataset.volume || "review",
        title: (el.querySelector("h2") || {}).textContent || "",
        el: el,
        members: members
      };
    });
  }

  function loadProgress() {
    const empty = { built: {}, stars: {} };
    try {
      const data = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!data || typeof data !== "object") return empty;
      const built = {};
      const stars = {};
      if (data.built && typeof data.built === "object") {
        Object.keys(data.built).forEach(function (id) {
          const list = data.built[id];
          if (Array.isArray(list)) built[id] = list.filter(function (item) { return typeof item === "string"; });
        });
      }
      if (data.stars && typeof data.stars === "object") {
        Object.keys(data.stars).forEach(function (id) {
          const value = Number(data.stars[id]);
          if (value >= 1 && value <= 3) stars[id] = Math.round(value);
        });
      }
      return { built: built, stars: stars };
    } catch (err) {
      return empty;
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ built: progress.built, stars: progress.stars }));
    } catch (err) {
      /* keep the in-memory copy when storage is blocked */
    }
  }

  function builtSet(id) {
    return new Set(progress.built[id] || []);
  }

  function markBuilt(id, en) {
    const next = builtSet(id);
    next.add(en);
    progress.built[id] = Array.from(next);
    save();
    updateProgressUI();
  }

  function stageOf(family) {
    const done = family.members.filter(function (member) { return builtSet(family.id).has(member.en); }).length;
    const stars = progress.stars[family.id] || 0;
    if (stars >= 3) return 3;
    if (done >= family.members.length || stars >= 2) return 2;
    if (done > 0 || stars >= 1) return 1;
    return 0;
  }

  function growthText(family) {
    const done = family.members.filter(function (member) { return builtSet(family.id).has(member.en); }).length;
    const stars = progress.stars[family.id] || 0;
    if (family.kind === "bank") {
      return stars > 0 ? "测验 " + stars + " 星" : "还没测验。";
    }
    if (done === 0 && stars === 0) return "还没开始。";
    const starBit = stars > 0 ? "测验 " + stars + " 星" : "还没测验";
    return "已拼 " + done + "/" + family.members.length + "，" + starBit;
  }

  function updateProgressUI() {
    families.forEach(function (family) {
      const stage = stageOf(family);
      family.el.classList.toggle("is-grown", stage >= 2);
      const text = family.el.querySelector(".growth-text");
      if (text) text.textContent = growthText(family);
      const plant = document.querySelector('[data-plant="' + family.id + '"]');
      if (plant) {
        plant.classList.remove("stage-0", "stage-1", "stage-2", "stage-3");
        plant.classList.add("stage-" + stage);
        plant.setAttribute("aria-label", family.title.trim() + "，" + growthText(family));
      }
    });
  }

  function updateStartLink() {
    const link = document.getElementById("start");
    if (!link) return;
    const here = families.filter(function (family) { return matchesShelf(family.shelf, family.volume); });
    const pool = here.length ? here : families;
    const next = pool.find(function (family) { return (progress.stars[family.id] || 0) < 3; }) || pool[0];
    if (next) link.href = "#" + next.id;
  }

  function matchesShelf(shelfId, volumeId) {
    if ((shelfId || "review") !== shelf) return false;
    if (shelf === "review") return true;
    return (volumeId || "a") === volume;
  }

  function bindChoice(tab, attr, assign) {
    tab.addEventListener("click", function () {
      assign(tab.getAttribute(attr));
      applyShelf();
    });
    tab.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const tabs = Array.from(tab.parentElement.querySelectorAll("[" + attr + "]"));
      const index = tabs.indexOf(tab);
      const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
      const next = tabs[(index + step + tabs.length) % tabs.length];
      event.preventDefault();
      next.focus();
      next.click();
    });
  }

  function applyShelf() {
    document.querySelectorAll("[data-shelf-pick]").forEach(function (tab) {
      const on = tab.getAttribute("data-shelf-pick") === shelf;
      tab.classList.toggle("is-chosen", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll("[data-volume-pick]").forEach(function (tab) {
      const on = tab.getAttribute("data-volume-pick") === volume;
      tab.classList.toggle("is-chosen", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll(".volume-switch").forEach(function (el) {
      if (shelf === "review") el.setAttribute("hidden", "");
      else el.removeAttribute("hidden");
    });
    let shown = 0;
    families.forEach(function (family) {
      const on = matchesShelf(family.shelf, family.volume);
      if (on) shown += 1;
      family.el.classList.toggle("is-shelf-off", !on);
    });
    document.querySelectorAll("[data-plant], .module-banner").forEach(function (plant) {
      const on = matchesShelf(plant.dataset.shelf || "review", plant.dataset.volume || "review");
      plant.classList.toggle("is-shelf-off", !on);
    });
    const volumeLabel = volume === "b" ? "下册" : "上册";
    const grade = gradeName[shelf] || "";
    const unpublished = (shelf === "5" || shelf === "6") && volume === "b";
    document.querySelectorAll("[data-book-empty]").forEach(function (el) {
      const listSection = el.classList.contains("home-only");
      if (shown === 0 && unpublished && listSection) {
        el.setAttribute("hidden", "");
        return;
      }
      if (shown === 0) {
        el.removeAttribute("hidden");
        if (!booksReady) el.textContent = "词表没有载入。刷新一下再试。";
        else if (unpublished) el.textContent = "五下、六下新版还没有出版，这里没有收录。";
        else el.textContent = "这一册的词还没放上来。";
      } else el.setAttribute("hidden", "");
    });
    document.querySelectorAll("[data-shelf-title]").forEach(function (el) {
      el.textContent = shelf === "review" ? "8 个词族" : grade + volumeLabel;
    });
    document.querySelectorAll("[data-shelf-lead]").forEach(function (el) {
      if (shelf === "review") el.textContent = "点进去拼一拼。星星留在这台浏览器里。";
      else if (shown === 0 && !booksReady) el.textContent = "词表没有载入。刷新一下再试。";
      else if (unpublished) el.textContent = "五下、六下新版还没有出版，这里没有收录。";
      else if (shown === 0) el.textContent = "这一册的词还没放上来。";
      else el.textContent = "教科版（广州版）" + grade + volumeLabel + "。点进去认单词和语块。星星留在这台浏览器里。";
    });
    document.querySelectorAll("[data-shelf-note]").forEach(function (el) {
      el.textContent = shelf === "review"
        ? "这 8 个词族是人教 PEP 四年级上册，留着复习。"
        : "教科版（广州版）" + grade + volumeLabel + "。";
    });
    document.querySelectorAll("[data-star-legend]").forEach(function (el) {
      const text = shelf === "review" || shown === 0 ? "" : (starLegends[shelf + volume] || "");
      el.textContent = text;
      if (text) el.removeAttribute("hidden");
      else el.setAttribute("hidden", "");
    });
    updateStartLink();
  }

  function parseRoute() {
    const raw = decodeURIComponent((location.hash || "").replace(/^#/, ""));
    if (!raw || raw === "home") return { name: "home" };
    if (raw === "families" || raw === "garden") return { name: "home", scroll: raw };
    const bits = raw.split("/");
    const id = bits[0];
    const mode = bits[1] || "";
    if (families.some(function (family) { return family.id === id; })) {
      return { name: "family", id: id, mode: mode };
    }
    return { name: "home" };
  }

  function normalizeMode(family, mode) {
    if (family.kind === "bank") return mode === "quiz" ? "quiz" : "review";
    const allowed = family.kind === "phonics" ? ["read", "review", "quiz"] : ["build", "review", "quiz"];
    if (family.kind === "phonics" && mode === "review") return "read";
    if (allowed.indexOf(mode) === -1) return family.kind === "phonics" ? "read" : "build";
    return mode;
  }

  function go(hash) {
    const next = hash.charAt(0) === "#" ? hash : "#" + hash;
    if (location.hash === next) render();
    else location.hash = next;
  }

  function render() {
    const route = parseRoute();
    if (route.name === "family") {
      const found = families.find(function (item) { return item.id === route.id; });
      if (found) {
        shelf = found.shelf || "review";
        if (shelf !== "review" && found.volume) volume = found.volume;
      }
    }
    applyShelf();
    document.body.classList.toggle("view-home", route.name === "home");
    document.body.classList.toggle("view-family", route.name === "family");
    families.forEach(function (family) {
      const on = route.name === "family" && route.id === family.id;
      family.el.classList.toggle("is-current", on);
      if (!on) {
        family.el.dataset.mode = "";
        family.el.dataset.ready = "";
      }
    });
    updateNav(route);
    if (route.name === "family") {
      const family = families.find(function (item) { return item.id === route.id; });
      const mode = normalizeMode(family, route.mode);
      const entered = lastFamilyId !== family.id;
      lastFamilyId = family.id;
      const needsPaint = family.el.dataset.mode !== mode || family.el.dataset.ready !== "1";
      family.el.dataset.mode = mode;
      if (needsPaint) {
        family.el.dataset.ready = "1";
        paintMode(family, mode);
      }
      if (entered) {
        requestAnimationFrame(function () {
          family.el.scrollIntoView({ block: "start", behavior: "auto" });
          const heading = family.el.querySelector("h2");
          if (heading) heading.focus({ preventScroll: true });
        });
      }
      return;
    }
    lastFamilyId = null;
    if (route.scroll) {
      const target = document.getElementById(route.scroll);
      if (target) target.scrollIntoView({ block: "start", behavior: "auto" });
    }
  }

  function updateNav(route) {
    document.querySelectorAll("[data-nav]").forEach(function (link) {
      const key = link.dataset.nav;
      let on = false;
      if (route.name === "home" && route.scroll === key) on = true;
      if (route.name === "family" && key === "families") on = true;
      if (on) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
      link.classList.toggle("is-chosen", on);
    });
  }

  function bindTab(tab) {
    tab.addEventListener("click", function () {
      const family = tab.closest(".family");
      go(family.id + "/" + tab.dataset.tab);
    });
    tab.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      const tabs = Array.from(tab.parentElement.querySelectorAll("[data-tab]"));
      const index = tabs.indexOf(tab);
      const step = event.key === "ArrowRight" ? 1 : -1;
      const next = tabs[(index + step + tabs.length) % tabs.length];
      event.preventDefault();
      next.focus();
      next.click();
    });
  }

  function syncTabs(family, mode) {
    family.el.querySelectorAll("[data-tab]").forEach(function (tab) {
      const on = tab.dataset.tab === mode;
      tab.classList.toggle("is-chosen", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
    });
  }

  function paintMode(family, mode) {
    enhanceStudy(family);
    syncTabs(family, mode);
    if (mode === "build") {
      family.cursor = firstCursor(family);
      paintBuild(family);
      return;
    }
    if (mode === "quiz") {
      paintQuiz(family);
      return;
    }
    const board = family.el.querySelector("[data-board]");
    board.replaceChildren();
    const help = document.createElement("p");
    help.className = "help";
    help.textContent = speechOK ? "点「看意思」看中文，点「听」听读音。" : "点「看意思」看中文。";
    board.append(help);
    family.el.querySelectorAll(".pat").forEach(function (mark) {
      mark.classList.remove("rise");
      void mark.offsetWidth;
      mark.classList.add("rise");
    });
  }

  function firstCursor(family) {
    const done = builtSet(family.id);
    const index = family.members.findIndex(function (member) { return !done.has(member.en); });
    return index === -1 ? 0 : index;
  }

  function enhanceStudy(family) {
    family.members.forEach(function (member) {
      const li = member.li;
      if (li.dataset.enhanced === "1") return;
      li.dataset.enhanced = "1";
      const reveal = document.createElement("button");
      reveal.type = "button";
      reveal.className = "press";
      reveal.textContent = "看意思";
      reveal.setAttribute("aria-expanded", "false");
      reveal.addEventListener("click", function () {
        const open = li.classList.toggle("is-open");
        reveal.textContent = open ? "收起" : "看意思";
        reveal.setAttribute("aria-expanded", open ? "true" : "false");
      });
      li.append(reveal);
      const spoken = speakButton(member.en);
      if (spoken) li.append(spoken);
    });
  }

  function paintBuild(family) {
    const board = family.el.querySelector("[data-board]");
    const member = family.members[family.cursor];
    board.replaceChildren();
    if (!member) {
      paintBuildDone(family);
      return;
    }
    const step = document.createElement("p");
    step.className = "help";
    step.textContent = "第 " + (family.cursor + 1) + " 个，共 " + family.members.length + " 个";
    const prompt = document.createElement("p");
    prompt.className = "prompt-zh";
    prompt.textContent = member.zh;
    const help = document.createElement("p");
    help.className = "help";
    const done = builtSet(family.id);
    const all = family.members.every(function (item) { return done.has(item.en); });
    help.textContent = all
      ? "这些词都拼过了，再练一回也很好。点一下，或拖到上面。"
      : "点一下，或拖到上面，按顺序拼。";
    const feedback = document.createElement("p");
    feedback.className = "feedback";
    board.append(step, prompt, help);
    const tools = document.createElement("div");
    tools.className = "builder-tools";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "press";
    reset.textContent = "重来";
    let api = null;
    reset.addEventListener("click", function () {
      if (api) api.clear();
      feedback.textContent = "";
    });
    tools.append(reset);
    api = mountBuilder(board, family, member, {
      once: false,
      onClear: function () {
        feedback.textContent = "";
      },
      onJudge: function (correct, parts) {
        if (!correct) {
          const other = family.members.find(function (item) {
            return item.en !== member.en && sameParts(parts, item.parts);
          });
          if (other) {
            feedback.textContent = "这是 " + other.en + "，" + other.zh + "。这一题要的是" + member.zh + "。";
          } else if (sameSet(parts, member.parts)) {
            feedback.textContent = "顺序还不对。换一换位置。";
          } else {
            feedback.textContent = "还没拼上。再试试。";
          }
          announce(feedback.textContent);
          return;
        }
        markBuilt(family.id, member.en);
        reset.hidden = true;
        if (api) api.finish();
        feedback.textContent = "";
        showSuccess(board, family, member);
      }
    });
    board.append(tools, feedback);
  }

  function showSuccess(board, family, member) {
    const box = document.createElement("div");
    box.className = "result is-settled";
    const row = document.createElement("div");
    row.className = "result-row";
    const word = document.createElement("p");
    word.className = "result-en";
    const marked = document.createElement("mark");
    marked.lang = "en";
    marked.textContent = member.en;
    word.append(marked);
    appendIpa(word, member.ipa);
    row.append(word);
    const spoken = speakButton(member.en);
    if (spoken) row.append(spoken);
    const zh = document.createElement("p");
    zh.className = "result-zh";
    zh.textContent = member.zh;
    const bits = document.createElement("p");
    bits.className = "help";
    bits.textContent = partLine(member);
    box.append(row, zh, bits);
    if (member.note) {
      const note = document.createElement("p");
      note.className = "help";
      note.textContent = member.note;
      box.append(note);
    }
    if (member.unit) {
      const unit = document.createElement("p");
      unit.className = "unit";
      unit.textContent = member.unit;
      box.append(unit);
    }
    const next = document.createElement("button");
    next.type = "button";
    next.className = "press btn--primary";
    const last = family.cursor + 1 >= family.members.length;
    next.textContent = last ? "这一族拼完了" : "下一个词";
    next.addEventListener("click", function () {
      family.cursor += 1;
      if (family.cursor >= family.members.length) paintBuildDone(family);
      else paintBuild(family);
    });
    box.append(next);
    board.append(box);
    const message = "拼对了。" + member.en + "，" + member.zh + "。";
    announce(message);
    speak(member.en);
    next.focus();
  }

  function paintBuildDone(family) {
    const board = family.el.querySelector("[data-board]");
    board.replaceChildren();
    const title = document.createElement("p");
    title.className = "prompt-zh";
    title.textContent = "这一族都拼过了。";
    const help = document.createElement("p");
    help.className = "help";
    help.textContent = "去小测验，给这一族记星。";
    const actions = document.createElement("div");
    actions.className = "quiz-actions";
    const quiz = document.createElement("button");
    quiz.type = "button";
    quiz.className = "press btn--primary";
    quiz.textContent = "去小测验";
    quiz.addEventListener("click", function () { go(family.id + "/quiz"); });
    const again = document.createElement("button");
    again.type = "button";
    again.className = "press";
    again.textContent = "再拼一次";
    again.addEventListener("click", function () {
      family.cursor = 0;
      paintBuild(family);
    });
    actions.append(quiz, again);
    board.append(title, help, actions);
    announce("这一族都拼过了。");
  }

  function mountBuilder(parent, family, member, opts) {
    const strip = document.createElement("div");
    strip.className = "strip";
    const shape = document.createElement("span");
    shape.className = "strip-shape";
    shape.setAttribute("aria-hidden", "true");
    const slots = document.createElement("div");
    slots.className = "strip-row slots";
    slots.dataset.slots = "1";
    slots.setAttribute("aria-label", "拼词区");
    member.parts.forEach(function () {
      const slot = document.createElement("div");
      slot.className = "slot empty";
      const hint = document.createElement("span");
      hint.className = "slot-hint";
      hint.textContent = "放";
      hint.setAttribute("aria-hidden", "true");
      slot.append(hint);
      slots.append(slot);
    });
    const bank = document.createElement("div");
    bank.className = "bank";
    let locked = false;

    function currentParts() {
      return Array.from(slots.querySelectorAll(".slot")).map(function (slot) {
        const tile = slot.querySelector(".tile");
        return tile ? tile.dataset.part : null;
      });
    }

    function sync() {
      if (locked) return;
      const parts = currentParts();
      if (!parts.every(Boolean)) {
        if (opts.onClear) opts.onClear();
        return;
      }
      const correct = parts.every(function (part, index) { return part === member.parts[index]; });
      if (opts.once) {
        lock();
        opts.onJudge(correct, parts);
        return;
      }
      opts.onJudge(correct, parts);
      if (correct) lock();
    }

    function place(button) {
      if (locked) return;
      if (button.parentElement.classList.contains("slot")) return;
      const empty = slots.querySelector(".slot.empty");
      if (!empty) return;
      empty.classList.remove("empty");
      empty.append(button);
      sync();
    }

    function unplace(button) {
      if (locked) return;
      const slot = button.parentElement;
      if (!slot || !slot.classList.contains("slot")) return;
      bank.append(button);
      slot.classList.add("empty");
      sync();
    }

    function lock() {
      locked = true;
      strip.querySelectorAll("button").forEach(function (button) { button.disabled = true; });
      bank.querySelectorAll("button").forEach(function (button) { button.disabled = true; });
    }

    function clear() {
      if (locked) return;
      Array.from(slots.querySelectorAll(".tile")).forEach(unplace);
    }

    bankFor(family, member).forEach(function (part) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "press tile";
      button.lang = "en";
      button.textContent = part;
      button.dataset.part = part;
      button.setAttribute("aria-label", partLabel(family, part));
      button.addEventListener("click", function () {
        if (button.parentElement.classList.contains("slot")) unplace(button);
        else place(button);
      });
      bindDrag(button, function () {
        return { place: place, unplace: unplace };
      });
      bank.append(button);
    });

    strip.append(shape, slots);
    parent.append(strip, bank);
    return {
      clear: clear,
      finish: function () { bank.hidden = true; }
    };
  }

  function bankFor(family, member) {
    const needed = member.parts.slice();
    const extras = [];
    family.members.forEach(function (item) {
      if (item.en === member.en) return;
      item.parts.forEach(function (part) {
        if (needed.indexOf(part) === -1 && extras.indexOf(part) === -1) extras.push(part);
      });
    });
    return shuffle(needed.concat(shuffle(extras).slice(0, Math.max(0, 5 - needed.length))));
  }

  function partLabel(family, part) {
    for (let i = 0; i < family.members.length; i += 1) {
      const member = family.members[i];
      const index = member.parts.indexOf(part);
      if (index >= 0) {
        const zh = member.partZh[index];
        return zh ? part + "，" + zh : part;
      }
    }
    return part;
  }

  function bindDrag(button, getApi) {
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let ghost = null;

    button.addEventListener("pointerdown", function (event) {
      if (event.pointerType !== "mouse" || event.button !== 0 || button.disabled) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      dragging = false;
      button.setPointerCapture(pointerId);
    });

    button.addEventListener("pointermove", function (event) {
      if (event.pointerId !== pointerId) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!dragging && dx * dx + dy * dy > 36) {
        dragging = true;
        ghost = document.createElement("div");
        ghost.className = "press tile tile-ghost";
        ghost.textContent = button.textContent;
        document.body.append(ghost);
        button.classList.add("is-dim");
      }
      if (ghost) {
        ghost.style.translate = (event.clientX - ghost.offsetWidth / 2) + "px " + (event.clientY - 28) + "px";
      }
    });

    button.addEventListener("pointerup", function (event) {
      if (event.pointerId !== pointerId) return;
      const wasDragging = dragging;
      if (wasDragging) {
        button.classList.remove("is-dim");
        if (ghost) ghost.remove();
        ghost = null;
        const under = document.elementFromPoint(event.clientX, event.clientY);
        const api = getApi();
        if (under && under.closest("[data-slots]")) api.place(button);
        else if (under && under.closest(".bank")) api.unplace(button);
        button.addEventListener("click", function (clickEvent) {
          clickEvent.stopPropagation();
          clickEvent.preventDefault();
        }, { capture: true, once: true });
      }
      pointerId = null;
      dragging = false;
    });

    button.addEventListener("pointercancel", function (event) {
      if (event.pointerId !== pointerId) return;
      button.classList.remove("is-dim");
      if (ghost) ghost.remove();
      ghost = null;
      pointerId = null;
      dragging = false;
    });
  }

  function paintQuiz(family) {
    if (!family.members.length) {
      const board = family.el.querySelector("[data-board]");
      board.replaceChildren();
      const help = document.createElement("p");
      help.className = "help";
      help.textContent = "这一组还没有词。";
      board.append(help);
      return;
    }
    const questions = buildQuestions(family);
    paintQuestion(family, { questions: questions, index: 0, correct: 0 });
  }

  function buildQuestions(family) {
    const types = family.kind === "phonics" || family.kind === "bank"
      ? ["zh-to-en", "en-to-zh", "listen-zh"]
      : ["zh-to-en", "parts-to-en", "assemble", "listen-zh"];
    const questions = family.members.map(function (member, index) {
      return normalizeQuestion(family, { type: types[index % types.length], member: member });
    });
    if (family.kind === "phonics") {
      questions.push(normalizeQuestion(family, {
        type: "which-pattern",
        member: family.members[family.members.length - 1]
      }));
    } else if (family.kind !== "bank" && family.members.length < 4) {
      const member = family.members.find(function (item) { return item.parts.length >= 2; }) || family.members[0];
      questions.push(normalizeQuestion(family, {
        type: member.parts.length >= 2 ? "assemble" : "zh-to-en",
        member: member
      }));
    }
    return questions;
  }

  function normalizeQuestion(family, question) {
    let type = question.type;
    if (type === "listen-zh" && !speechOK) type = "zh-to-en";
    if ((type === "assemble" || type === "parts-to-en") && question.member.parts.length < 2) type = "zh-to-en";
    return { type: type, member: question.member, family: family };
  }

  function paintQuestion(family, state) {
    const board = family.el.querySelector("[data-board]");
    const question = state.questions[state.index];
    board.replaceChildren();
    const step = document.createElement("p");
    step.className = "help";
    step.textContent = "第 " + (state.index + 1) + " 题，共 " + state.questions.length + " 题";
    board.append(step);
    if (question.type === "assemble") paintAssembleQuestion(family, state, question, board);
    else paintChoiceQuestion(family, state, question, board);
  }

  function paintChoiceQuestion(family, state, question, board) {
    const member = question.member;
    const prompt = document.createElement("div");
    prompt.className = "q-prompt";
    if (question.type === "zh-to-en") {
      prompt.append(promptLine(member.zh, false), helpLine(member.item === "chunk" ? "选出对应的语块。" : "选出对应的英文。"));
    } else if (question.type === "en-to-zh") {
      const word = document.createElement("p");
      word.className = "prompt-zh";
      word.lang = "en";
      if (family.pattern) word.innerHTML = markedHTML(member.en, family.pattern);
      else word.textContent = member.en;
      if (member.pos) {
        const pos = document.createElement("span");
        pos.className = "pos";
        pos.textContent = " " + member.pos;
        word.append(pos);
      }
      appendIpa(word, member.ipa);
      prompt.append(word, helpLine(member.item === "chunk" ? "这个语块是什么意思？" : "这个词是什么意思？"));
    } else if (question.type === "listen-zh") {
      prompt.append(promptLine("听一听", false), helpLine("选出听到的意思。"));
      const again = speakButton(member.en);
      if (again) {
        again.textContent = "再听一次";
        prompt.append(again);
      }
    } else if (question.type === "parts-to-en") {
      prompt.append(partStrip(member), helpLine("这些词块拼成哪个词？"));
    } else {
      prompt.append(promptLine("哪个是 " + family.pattern, false), helpLine("读 " + family.sound + " 的那一个。"));
    }
    board.append(prompt);

    const english = question.type === "zh-to-en" || question.type === "parts-to-en" || question.type === "which-pattern";
    const key = english ? "en" : "zh";
    const pool = question.type === "which-pattern"
      ? families.filter(function (item) { return item.kind === "phonics" && item.id !== family.id; }).flatMap(function (item) { return item.members; })
      : optionPool(family, member, key);
    const options = pickOptions(member, pool, key, 4);
    const correctLabel = member[key];
    const choices = document.createElement("div");
    choices.className = "choices";
    const feedback = document.createElement("p");
    feedback.className = "feedback";

    options.forEach(function (item) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "press choice";
      button.dataset.value = item[key];
      if (key === "en") {
        button.lang = "en";
        const label = document.createElement("span");
        label.textContent = item[key];
        button.append(label);
        appendIpa(button, item.ipa);
      } else {
        button.textContent = item[key];
      }
      button.addEventListener("click", function () {
        const right = button.dataset.value === correctLabel;
        if (right) state.correct += 1;
        choices.querySelectorAll("button").forEach(function (el) {
          el.disabled = true;
          if (el.dataset.value === correctLabel) el.classList.add("is-answer");
        });
        const message = choiceMessage(question, family, member, right);
        fillFeedback(feedback, message, member.ipa);
        announce(message + (member.ipa ? " " + member.ipa : ""));
        speak(member.en);
        board.append(nextButton(family, state));
      });
      choices.append(button);
    });
    board.append(choices, feedback);
    if (question.type === "listen-zh" && activation()) speak(member.en);
  }

  function paintAssembleQuestion(family, state, question, board) {
    const member = question.member;
    board.append(promptLine(member.zh, false), helpLine("用词块拼出英文。"));
    const feedback = document.createElement("p");
    feedback.className = "feedback";
    mountBuilder(board, family, member, {
      once: true,
      onJudge: function (correct) {
        if (correct) state.correct += 1;
        const message = correct
          ? "对了。" + member.en + "，" + member.zh + "。"
          : "这一题是 " + member.en + "，" + member.zh + "。";
        fillFeedback(feedback, message, member.ipa);
        announce(message + (member.ipa ? " " + member.ipa : ""));
        speak(member.en);
        board.append(nextButton(family, state));
      }
    });
    board.append(feedback);
  }

  function nextButton(family, state) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "press btn--primary";
    const last = state.index + 1 >= state.questions.length;
    button.textContent = last ? "看结果" : "下一题";
    button.addEventListener("click", function () {
      state.index += 1;
      if (state.index >= state.questions.length) paintQuizResult(family, state);
      else paintQuestion(family, state);
    });
    requestAnimationFrame(function () { button.focus(); });
    return button;
  }

  function choiceMessage(question, family, member, right) {
    if (question.type === "which-pattern") {
      return right
        ? "对了。" + member.en + " 是 " + family.pattern + "。"
        : "要找的是 " + member.en + "。它是 " + family.pattern + "。";
    }
    return right
      ? "对了。" + member.en + "，" + member.zh + "。"
      : member.en + " 是" + member.zh + "。";
  }

  function paintQuizResult(family, state) {
    const total = state.questions.length;
    const got = state.correct;
    const earned = starsFor(got, total);
    const prev = progress.stars[family.id] || 0;
    const best = Math.max(prev, earned);
    if (best > 0) progress.stars[family.id] = best;
    save();
    updateProgressUI();
    const board = family.el.querySelector("[data-board]");
    board.replaceChildren();
    const box = document.createElement("div");
    box.className = "quiz-result";
    if (got === total && total > 0) {
      const sticker = document.createElement("p");
      sticker.className = "sticker sticker-inline";
      sticker.textContent = "全对";
      box.append(sticker);
    }
    const title = document.createElement("p");
    title.className = "prompt-zh";
    title.textContent = got === 0 ? "这回还没对上。" : "对了 " + got + " 题，共 " + total + " 题。";
    const line = document.createElement("p");
    line.className = "help";
    if (earned === 0) {
      line.textContent = prev > 0 ? "最好的成绩还是 " + prev + " 星。再看一看，然后再测。" : "再看一看这一族，然后再测。";
    } else if (best > earned) {
      line.append("这回是 " + earned + " 星。最好的成绩还是 ");
      const mark = document.createElement("mark");
      mark.textContent = best + " 星";
      line.append(mark);
      line.append("。");
    } else {
      line.append("这一族记成 ");
      const mark = document.createElement("mark");
      mark.textContent = best + " 星";
      line.append(mark);
      line.append("。");
    }
    const actions = document.createElement("div");
    actions.className = "quiz-actions";
    const again = document.createElement("button");
    again.type = "button";
    again.className = "press btn--primary";
    again.textContent = "再测一次";
    again.addEventListener("click", function () { paintQuiz(family); });
    const review = document.createElement("button");
    review.type = "button";
    review.className = "press";
    review.textContent = family.kind === "phonics" ? "再看发音" : family.kind === "bank" ? "再认一认" : "先翻一翻";
    review.addEventListener("click", function () {
      const back = family.kind === "phonics" ? "read" : "review";
      go(family.id + "/" + back);
    });
    actions.append(again, review);
    box.append(title, line, actions);
    board.append(box);
    announce(title.textContent + line.textContent);
  }

  function starsFor(correct, total) {
    if (total <= 0 || correct <= 0) return 0;
    if (correct >= total) return 3;
    if (correct * 2 >= total) return 2;
    return 1;
  }

  function optionPool(family, member, key) {
    const same = family.members.filter(function (item) { return item[key] !== member[key]; });
    if (same.length >= 3) return same;
    const others = [];
    families.forEach(function (item) {
      item.members.forEach(function (word) {
        if (word[key] !== member[key] && !same.some(function (have) { return have[key] === word[key]; })) others.push(word);
      });
    });
    return same.concat(others);
  }

  function pickOptions(correct, pool, key, count) {
    const chosen = [correct];
    const seen = new Set([correct[key]]);
    shuffle(pool).forEach(function (item) {
      if (chosen.length >= count || seen.has(item[key])) return;
      seen.add(item[key]);
      chosen.push(item);
    });
    return shuffle(chosen);
  }

  function promptLine(text) {
    const p = document.createElement("p");
    p.className = "prompt-zh";
    p.textContent = text;
    return p;
  }

  function helpLine(text) {
    const p = document.createElement("p");
    p.className = "help";
    p.textContent = text;
    return p;
  }

  function partStrip(member) {
    const strip = document.createElement("div");
    strip.className = "strip";
    const shape = document.createElement("span");
    shape.className = "strip-shape";
    shape.setAttribute("aria-hidden", "true");
    const row = document.createElement("div");
    row.className = "strip-row";
    member.parts.forEach(function (part) {
      const tile = document.createElement("span");
      tile.className = "press tile";
      tile.lang = "en";
      tile.textContent = part;
      row.append(tile);
    });
    strip.append(shape, row);
    return strip;
  }

  function partLine(member) {
    return member.parts.map(function (part, index) {
      const zh = member.partZh[index] || "";
      return zh ? part + " " + zh : part;
    }).join("，");
  }

  function sameParts(left, right) {
    return left.length === right.length && left.every(function (part, index) { return part === right[index]; });
  }

  function sameSet(left, right) {
    return left.length === right.length && right.every(function (part) { return left.indexOf(part) !== -1; });
  }

  function markedHTML(word, pattern) {
    const chars = Array.from(word);
    if (!pattern) return escapeHTML(word);
    const vowel = pattern.charAt(0).toLowerCase();
    let vowelAt = -1;
    let silentE = -1;
    chars.forEach(function (char, index) {
      if (vowelAt < 0 && char.toLowerCase() === vowel) vowelAt = index;
      if (char.toLowerCase() === "e") silentE = index;
    });
    return chars.map(function (char, index) {
      const safe = escapeHTML(char);
      return index === vowelAt || index === silentE ? '<mark class="pat">' + safe + "</mark>" : safe;
    }).join("");
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>]/g, function (char) {
      if (char === "&") return "&amp;";
      if (char === "<") return "&lt;";
      return "&gt;";
    });
  }

  function shuffle(list) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const hold = copy[i];
      copy[i] = copy[j];
      copy[j] = hold;
    }
    return copy;
  }

  function speakButton(text) {
    if (!speechOK || !text) return null;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "press speak";
    button.textContent = "听";
    button.setAttribute("aria-label", "听 " + text);
    button.addEventListener("click", function () { speak(text); });
    return button;
  }

  function speak(text) {
    if (!speechOK || !text) return;
    const synth = window.speechSynthesis;
    try {
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.rate = 0.9;
      synth.speak(utterance);
      if (synth.paused) synth.resume();
    } catch (err) {
      speechOK = false;
    }
  }

  function activation() {
    return !!(navigator.userActivation && navigator.userActivation.isActive);
  }

  function announce(message) {
    const live = document.getElementById("live");
    if (!live) return;
    live.textContent = "";
    requestAnimationFrame(function () { live.textContent = message; });
  }

  function appendIpa(parent, ipa) {
    if (!ipa) return;
    const span = document.createElement("span");
    span.className = "ipa";
    span.textContent = ipa;
    parent.append(span);
  }

  function fillFeedback(el, message, ipa) {
    el.replaceChildren(document.createTextNode(message));
    appendIpa(el, ipa);
  }

  function loadBooks() {
    return Promise.all(BOOK_CODES.map(function (code) {
      return fetch("data/" + code + ".json").then(function (res) {
        if (!res.ok) throw new Error(code + " " + res.status);
        return res.json();
      }).then(function (book) {
        checkBook(code, book);
        return book;
      });
    }));
  }

  function checkBook(code, book) {
    const words = book.words || [];
    const chunks = book.chunks || [];
    const expect = EXPECTED[code];
    if (!book.volume || book.volume.code !== code) throw new Error("volume " + code);
    if (book.volume.term !== "上" && book.volume.term !== "下") throw new Error("term " + code);
    if (words.length !== expect[0] || chunks.length !== expect[1]) throw new Error("count " + code);
    words.concat(chunks).forEach(function (item) {
      if (!item || typeof item.en !== "string" || !item.en || typeof item.zh !== "string" || !item.unit || !item.ipa || typeof item.star !== "boolean") {
        throw new Error("item " + code + " " + (item && item.en));
      }
    });
  }

  function legendFrom(edition) {
    const text = edition || "";
    if (text.indexOf("只要求了解词义") !== -1) return "标☆白体的只要求了解词义。没标的是黑体，要求理解运用。";
    if (text.indexOf("二级词汇") !== -1) return "标☆白体的不是课标二级词汇。没标的是黑体，是课标二级词汇。";
    return "标☆的是书上的白体。没标的是黑体。";
  }

  function mountBook(book, seen) {
    const grade = String(book.volume.grade);
    const vol = book.volume.term === "上" ? "a" : "b";
    const legend = legendFrom(book.edition || "");
    starLegends[grade + vol] = legend;
    const grid = document.querySelector(".family-grid");
    const plants = document.querySelector(".plants");
    if (!grid || !plants) throw new Error("missing mount point");
    groupUnits(book).forEach(function (unit) {
      const id = familyId(grade, vol, unit.title);
      if (seen.has(id) || document.getElementById(id)) throw new Error("duplicate " + id);
      seen.add(id);
      grid.append(renderFamily(unit, grade, vol, id, legend));
      plants.append(renderPlant(unit, grade, vol, id));
    });
  }

  function groupUnits(book) {
    const map = new Map();
    function bucket(unit) {
      if (!map.has(unit)) map.set(unit, { title: unit, words: [], chunks: [] });
      return map.get(unit);
    }
    (book.words || []).forEach(function (item) { bucket(item.unit).words.push(item); });
    (book.chunks || []).forEach(function (item) { bucket(item.unit).chunks.push(item); });
    return Array.from(map.values()).sort(function (a, b) {
      return unitRank(a.title) - unitRank(b.title);
    });
  }

  function unitRank(title) {
    const numbered = /^Unit (\d+)\b/.exec(title);
    if (numbered) return Number(numbered[1]);
    if (title.indexOf("Review") === 0) return 1000;
    return 900;
  }

  function familyId(grade, vol, title) {
    const numbered = /^Unit (\d+)\b/.exec(title);
    if (numbered) return "gz-" + grade + vol + "-u" + numbered[1];
    if (title.indexOf("Review") === 0) return "gz-" + grade + vol + "-review";
    return "gz-" + grade + vol + "-x-" + encodeURIComponent(title);
  }

  function renderFamily(unit, grade, vol, id, legend) {
    const article = document.createElement("article");
    article.className = "family";
    article.id = id;
    article.dataset.shelf = grade;
    article.dataset.volume = vol;
    article.dataset.kind = "bank";
    article.dataset.pattern = "";
    article.dataset.sound = "";

    const header = document.createElement("header");
    header.className = "family-head";
    const back = document.createElement("a");
    back.className = "back";
    back.href = "#families";
    back.textContent = "回到词表";
    const heading = document.createElement("h2");
    heading.tabIndex = -1;
    heading.textContent = unit.title;
    const hook = document.createElement("p");
    hook.className = "hook";
    hook.textContent = unit.words.length + " 个词，" + unit.chunks.length + " 个语块。";
    const gloss = document.createElement("p");
    gloss.className = "gloss";
    gloss.textContent = legend;
    header.append(back, heading, hook, gloss, growthBlock(), enterLink(id));

    const study = document.createElement("div");
    study.className = "study";
    if (unit.words.length) study.append(studyHead("这一课的词", false), studyList(unit.words, "word"));
    if (unit.chunks.length) study.append(studyHead("这一课的语块", true), studyList(unit.chunks, "chunk"));
    article.append(header, modeTabs(), emptyBoard(), study);
    return article;
  }

  function growthBlock() {
    const growth = document.createElement("p");
    growth.className = "growth";
    growth.dataset.growth = "";
    const mark = document.createElement("span");
    mark.className = "grown-mark";
    mark.textContent = "长成了";
    const text = document.createElement("span");
    text.className = "growth-text";
    text.textContent = "进度记在这台设备上。";
    growth.append(mark, text);
    return growth;
  }

  function enterLink(id) {
    const link = document.createElement("a");
    link.className = "press enter";
    link.href = "#" + id;
    link.textContent = "认这一课";
    return link;
  }

  function modeTabs() {
    const tabs = document.createElement("div");
    tabs.className = "tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "玩法");
    ["review", "quiz"].forEach(function (mode) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "press";
      button.setAttribute("role", "tab");
      button.dataset.tab = mode;
      button.setAttribute("aria-selected", "false");
      button.textContent = mode === "quiz" ? "小测验" : "认一认";
      tabs.append(button);
    });
    return tabs;
  }

  function emptyBoard() {
    const board = document.createElement("div");
    board.className = "board";
    board.dataset.board = "";
    return board;
  }

  function studyHead(text, chunks) {
    const heading = document.createElement("h3");
    if (chunks) heading.className = "chunk-head";
    heading.textContent = text;
    return heading;
  }

  function studyList(items, kind) {
    const list = document.createElement("ol");
    items.forEach(function (item) { list.append(renderItem(item, kind)); });
    return list;
  }

  function renderItem(item, kind) {
    const li = document.createElement("li");
    li.dataset.en = item.en;
    li.dataset.zh = item.zh;
    li.dataset.parts = "";
    li.dataset.partzh = "";
    li.dataset.unit = item.unit;
    li.dataset.note = item.note || "";
    li.dataset.pos = "";
    li.dataset.ipa = item.ipa;
    li.dataset.star = item.star ? "true" : "false";
    li.dataset.item = kind;

    const line = document.createElement("span");
    line.className = "wordline";
    const en = document.createElement("span");
    en.className = "en";
    en.lang = "en";
    en.textContent = item.en;
    line.append(en);
    appendIpa(line, item.ipa);
    const zh = document.createElement("span");
    zh.className = "zh";
    zh.textContent = item.zh;
    li.append(line, zh);
    if (item.star) {
      const flag = document.createElement("span");
      flag.className = "flag";
      flag.textContent = "☆ 白体";
      li.append(flag);
    }
    const unit = document.createElement("span");
    unit.className = "unit";
    unit.textContent = item.unit;
    li.append(unit);
    if (item.note) {
      const note = document.createElement("span");
      note.className = "note";
      note.textContent = item.note;
      li.append(note);
    }
    return li;
  }

  function renderPlant(unit, grade, vol, id) {
    const numbered = /^Unit (\d+)\b/.exec(unit.title);
    const link = document.createElement("a");
    link.className = "plant stage-0";
    link.href = "#" + id;
    link.dataset.plant = id;
    link.dataset.shelf = grade;
    link.dataset.volume = vol;
    link.setAttribute("aria-label", unit.title);
    const sprout = document.createElement("span");
    sprout.className = "sprout";
    sprout.setAttribute("aria-hidden", "true");
    const left = document.createElement("span");
    left.className = "leaf leaf-l";
    left.textContent = "(";
    const head = document.createElement("span");
    head.className = numbered ? "head num" : "head";
    if (numbered) head.lang = "en";
    head.textContent = numbered ? numbered[1] : "复";
    const right = document.createElement("span");
    right.className = "leaf leaf-r";
    right.textContent = ")";
    const stem = document.createElement("span");
    stem.className = "stem";
    stem.textContent = "l";
    sprout.append(left, head, right, stem);
    const name = document.createElement("span");
    name.className = "plant-name";
    name.textContent = numbered ? "U" + numbered[1] : "复习";
    link.append(sprout, name);
    return link;
  }
})();
