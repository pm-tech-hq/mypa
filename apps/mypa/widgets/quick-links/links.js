const $ = (id) => document.getElementById(id);
let links = [];
/** Index being edited in the form, or null when adding. */
let editing = null;
let removed = null;
let undoTimer = null;
let dragFrom = null;

const SVG_NS = "http://www.w3.org/2000/svg";
const ICONS = {
  x: "M4.5 4.5l7 7M11.5 4.5l-7 7",
  pencil: "M10.5 3.5l2 2L6 12H4v-2l6.5-6.5Z",
};

function icon(name, size = 12) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", ICONS[name]);
  p.setAttribute("fill", "none");
  p.setAttribute("stroke", "currentColor");
  p.setAttribute("stroke-width", "1.6");
  p.setAttribute("stroke-linecap", "round");
  p.setAttribute("stroke-linejoin", "round");
  svg.append(p);
  return svg;
}

function el(tag, props = {}, text) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  if (text !== undefined) e.textContent = text;
  return e;
}

const save = () => mypa.storage.set("links", links);
const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

function render() {
  const list = $("list");
  list.replaceChildren();
  if (!links.length) {
    list.append(el("p", { className: "ql__empty muted" }, "Add a name and a link below."));
    return;
  }
  links.forEach((l, i) => {
    const item = el("div", { className: `ql__item${editing === i ? " is-editing" : ""}` });
    item.draggable = true;
    item.dataset.index = String(i);

    const card = el("button", { className: "ql__link", type: "button", title: `Open ${l.url}` });
    card.append(el("span", { className: "ql__mono" }, l.name.slice(0, 1).toUpperCase()));
    const text = el("span", { className: "ql__text" });
    text.append(el("b", {}, l.name), el("small", {}, hostOf(l.url)));
    card.append(text);
    card.addEventListener("click", () => void mypa.openUrl(l.url));

    const tools = el("span", { className: "ql__tools" });
    const edit = el("button", { className: "ql__tool", type: "button", title: "Edit" });
    edit.setAttribute("aria-label", `Edit ${l.name}`);
    edit.append(icon("pencil"));
    edit.addEventListener("click", () => startEdit(i));
    const del = el("button", { className: "ql__tool ql__tool--del", type: "button", title: "Remove" });
    del.setAttribute("aria-label", `Remove ${l.name}`);
    del.append(icon("x"));
    del.addEventListener("click", () => remove(i));
    tools.append(edit, del);

    item.append(card, tools);

    // drag to reorder
    item.addEventListener("dragstart", (e) => {
      dragFrom = i;
      item.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", l.url);
    });
    item.addEventListener("dragend", () => {
      dragFrom = null;
      render();
    });
    item.addEventListener("dragover", (e) => {
      if (dragFrom === null || dragFrom === i) return;
      e.preventDefault();
      item.classList.add("is-over");
    });
    item.addEventListener("dragleave", () => item.classList.remove("is-over"));
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      if (dragFrom === null || dragFrom === i) return;
      const [moved] = links.splice(dragFrom, 1);
      links.splice(i, 0, moved);
      dragFrom = null;
      void save().then(render);
    });

    list.append(item);
  });
}

function startEdit(i) {
  editing = i;
  $("name").value = links[i].name;
  $("url").value = links[i].url;
  $("submit").textContent = "Save";
  $("cancel").hidden = false;
  $("url").focus();
  render();
}

function stopEdit() {
  editing = null;
  $("name").value = "";
  $("url").value = "";
  $("submit").textContent = "Add";
  $("cancel").hidden = true;
  $("err").hidden = true;
  render();
}

function remove(i) {
  const [link] = links.splice(i, 1);
  removed = { link, index: i };
  if (editing !== null) stopEdit();
  void save().then(render);
  $("undo-label").textContent = `Removed “${link.name}”`;
  $("undo").hidden = false;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndo, 6000);
}

function hideUndo() {
  $("undo").hidden = true;
  removed = null;
}

$("undo-btn").addEventListener("click", () => {
  if (!removed) return;
  links.splice(Math.min(removed.index, links.length), 0, removed.link);
  clearTimeout(undoTimer);
  hideUndo();
  void save().then(render);
});
$("undo-close").append(icon("x"));
$("undo-close").addEventListener("click", () => {
  clearTimeout(undoTimer);
  hideUndo();
});
$("cancel").addEventListener("click", stopEdit);
$("form").addEventListener("keydown", (e) => {
  if (e.key === "Escape" && editing !== null) stopEdit();
});

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("name").value.trim();
  let url = $("url").value.trim();
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  const err = $("err");
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") throw new Error();
  } catch {
    err.textContent = "Use a full https link, e.g. https://example.com";
    err.hidden = false;
    $("url").focus();
    return;
  }
  err.hidden = true;
  const link = { name: name || hostOf(url), url };
  if (editing !== null) links[editing] = link;
  else links.push(link);
  void save().then(() => {
    if (editing !== null) return stopEdit();
    $("name").value = "";
    $("url").value = "";
    render();
  });
});

mypa.ready.then(async () => {
  links = (await mypa.storage.get("links")) ?? [];
  render();
});
