// Everything goes through `mypa`: storage, settings, and (with permissions)
// tasks, calendar, network and notifications. See the SDK README.
const $ = (id) => document.getElementById(id);
let count = 0;

function render() {
  $("value").textContent = String(count);
  $("label").textContent = mypa.settings.label || "Clicks";
}

async function save() {
  await mypa.storage.set("count", count);
  render();
}

mypa.ready.then(async () => {
  count = (await mypa.storage.get("count")) ?? 0;
  render();
});

mypa.onSettings(render);

$("add").addEventListener("click", () => {
  count += Number(mypa.settings.step) || 1;
  void save();
});

$("reset").addEventListener("click", () => {
  count = 0;
  void save();
});
