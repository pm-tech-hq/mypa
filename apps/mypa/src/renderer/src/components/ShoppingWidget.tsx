import { useEffect, useMemo, useRef, useState } from "react";

import {
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  CornerDownLeft,
  ListPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  ShoppingCart,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";

import { parseAmount } from "../../../shared/expenses";
import {
  AISLES,
  aisleLabel,
  buyAgain,
  completions,
  listAsText,
  parseItems,
  planAdds,
  totalOf,
  type AisleId,
  type ShoppingHistory,
  type ShoppingItem,
} from "../../../shared/shopping";
import type { WidgetRow } from "../../../shared/types";
import { moneyFor } from "../lib/expensesUi";
import { useReadyStore } from "../lib/store";
import { useUndo } from "../lib/useUndo";
import { captureError } from "./CaptureComposer";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { UndoToast } from "./UndoToast";
import "../styles/shopping.css";

type Editing = { id: string; name: string; qty: string; aisle: AisleId; note: string; price: string; listId: string };

export function ShoppingWidget({ widget, onOpenSettings }: { widget: WidgetRow; onOpenSettings: () => void }) {
  const { snapshot, actions } = useReadyStore();
  const undo = useUndo(widget.id);
  const lists = snapshot.shoppingLists;
  const settings = snapshot.meta.shopping;
  const money = useMemo(() => moneyFor(snapshot.meta.expenses.currency), [snapshot.meta.expenses.currency]);

  const listId = lists.some((l) => l.id === widget.settings.shopListId) ? widget.settings.shopListId! : (lists[0]?.id ?? null);
  const list = lists.find((l) => l.id === listId) ?? null;
  const group = widget.settings.shopGroup !== false;
  const cartOpen = widget.settings.shopCartOpen !== false;
  const setW = (s: Partial<WidgetRow["settings"]>) => void actions.updateWidgetSettings(widget.id, s);

  const finishKey = `finish:${listId}`;
  const finishing = undo.hidden.has(finishKey);
  const items = useMemo(
    () =>
      snapshot.shoppingItems.filter(
        (i) => i.listId === listId && !undo.hidden.has(i.id) && !(finishing && i.checked),
      ),
    [snapshot.shoppingItems, listId, undo.hidden, finishing],
  );
  const open = items.filter((i) => !i.checked);
  const cart = items.filter((i) => i.checked).sort((a, b) => (b.checkedAt ?? 0) - (a.checkedAt ?? 0));
  const history = snapshot.shoppingHistory;

  const [text, setText] = useState("");
  const [pick, setPick] = useState(-1);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [naming, setNaming] = useState<{ mode: "new" | "rename"; value: string } | null>(null);
  const [done, setDone] = useState<{ log: boolean; amount: string; category: string } | null>(null);
  const [flash, setFlash] = useState<{ text: string; error?: boolean } | null>(null);
  const [saved, setSaved] = useState<{ key: number; label: string; undo: () => void } | null>(null);
  const [againOpen, setAgainOpen] = useState(true);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!saved) return;
    const t = window.setTimeout(() => setSaved(null), 8000);
    return () => window.clearTimeout(t);
  }, [saved]);
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 4000);
    return () => window.clearTimeout(t);
  }, [flash]);
  // the list this widget pointed at was deleted: follow the first one
  useEffect(() => {
    if (listId && widget.settings.shopListId !== listId) setW({ shopListId: listId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId]);

  const suggestions = useMemo(() => completions(text, history, items), [text, history, items]);
  const again = useMemo(() => buyAgain(history, items, Date.now()), [history, items]);
  const preview = useMemo(() => {
    if (!text.trim()) return null;
    const plan = planAdds(parseItems(text), items, history);
    return plan
      .map((o) =>
        o.kind === "new"
          ? `${o.item.name}${o.item.qty ? ` (${o.item.qty})` : ""} → ${aisleLabel(o.aisle)}`
          : o.kind === "more"
            ? `${o.name}: already on the list, now ${o.qty || "more"}`
            : `${o.name}: back from the cart`,
      )
      .join(" · ");
  }, [text, items, history]);

  const fail = (e: unknown) => setFlash({ text: captureError(e), error: true });

  const add = async (raw: string) => {
    if (!listId || !raw.trim()) return;
    const before = snapshot.shoppingItems.filter((i) => i.listId === listId);
    try {
      const r = await actions.addShopping(listId, raw);
      setText("");
      setPick(-1);
      const prev = before.filter((i) => r.changed.includes(i.id));
      const label =
        r.names.length === 1
          ? r.created.length
            ? `Added ${r.names[0]}`
            : `${r.names[0]}: updated`
          : `Added ${r.names.length} items`;
      setSaved({
        key: Date.now(),
        label,
        undo: () => {
          void actions.deleteShoppingItems(r.created);
          if (prev.length) void actions.putShoppingItems(prev);
        },
      });
    } catch (e) {
      fail(e);
    }
    input.current?.focus();
  };

  const addFromHistory = (h: ShoppingHistory) =>
    void add(`${h.qty ? `${h.qty} ` : ""}${h.name}${h.price !== null ? ` @${(h.price / 100).toFixed(2)}` : ""}`);

  const toggle = (i: ShoppingItem) => void actions.updateShoppingItem(i.id, { checked: !i.checked }).catch(fail);

  const remove = (i: ShoppingItem) => {
    if (editing?.id === i.id) setEditing(null);
    undo.schedule(i.id, `Removed ${i.name}`, () => void actions.deleteShoppingItems([i.id]));
  };

  const startEdit = (i: ShoppingItem) =>
    setEditing({
      id: i.id,
      name: i.name,
      qty: i.qty,
      aisle: i.aisle,
      note: i.note,
      price: i.price === null ? "" : (i.price / 100).toFixed(2),
      listId: i.listId,
    });

  const saveEdit = async () => {
    if (!editing) return;
    const orig = snapshot.shoppingItems.find((i) => i.id === editing.id);
    if (!orig) return setEditing(null);
    const price = editing.price.trim() ? parseAmount(editing.price) : null;
    if (editing.price.trim() && (price === null || price < 0)) {
      setFlash({ text: "That price doesn't look right.", error: true });
      return;
    }
    const patch: Partial<ShoppingItem> = {};
    if (editing.name.trim() && editing.name.trim() !== orig.name) patch.name = editing.name.trim();
    if (editing.qty.trim() !== orig.qty) patch.qty = editing.qty.trim();
    if (editing.aisle !== orig.aisle) patch.aisle = editing.aisle;
    if (editing.note.trim() !== orig.note) patch.note = editing.note.trim();
    if (price !== orig.price) patch.price = price;
    if (editing.listId !== orig.listId) patch.listId = editing.listId;
    setEditing(null);
    if (Object.keys(patch).length) {
      await actions.updateShoppingItem(orig.id, patch).catch(fail);
      if (patch.listId) setFlash({ text: `Moved to ${lists.find((l) => l.id === patch.listId)?.name}` });
    }
  };

  const cartTotal = totalOf(cart);
  const allTotal = totalOf(items);
  const categories = snapshot.expenseCategories;

  const startDone = () =>
    setDone({
      log: settings.logExpense && categories.length > 0,
      amount: cartTotal.priced ? (cartTotal.total / 100).toFixed(2) : "",
      category: categories.some((c) => c.id === settings.expenseCategory)
        ? settings.expenseCategory
        : (categories[0]?.id ?? ""),
    });

  const finish = () => {
    if (!done || !listId || !list) return;
    let expense: { amount: number; categoryId: string; note: string } | null = null;
    if (done.log) {
      const amount = parseAmount(done.amount);
      if (amount === null || amount <= 0) {
        setFlash({ text: "Enter what you spent, or untick “Log in Expenses”.", error: true });
        return;
      }
      expense = { amount, categoryId: done.category, note: list.name };
    }
    const n = cart.length;
    setDone(null);
    undo.schedule(
      finishKey,
      expense ? `Cleared ${n} from the cart · logged ${money(expense.amount)}` : `Cleared ${n} from the cart`,
      () => void actions.finishShopping(listId, expense),
    );
  };

  const saveName = async () => {
    if (!naming) return;
    const v = naming.value.trim();
    setNaming(null);
    if (!v) return;
    if (naming.mode === "new") {
      const id = await actions.createShoppingList(v);
      setW({ shopListId: id });
    } else if (listId) await actions.renameShoppingList(listId, v);
  };

  const deleteList = () => {
    if (!list) return;
    if (lists.length === 1 && !items.length) return;
    const key = `list:${list.id}`;
    const others = lists.filter((l) => l.id !== list.id);
    undo.schedule(key, `Deleted the “${list.name}” list`, () => void actions.deleteShoppingList(list.id));
    if (others[0]) setW({ shopListId: others[0].id });
  };

  // lists being deleted disappear at once
  const shownLists = lists.filter((l) => !undo.hidden.has(`list:${l.id}`));
  const deletingThis = list && undo.hidden.has(`list:${list.id}`);

  const order = settings.aisleOrder;
  const groups = useMemo(() => {
    if (!group) return [{ aisle: null as AisleId | null, items: open }];
    return order
      .map((a) => ({ aisle: a as AisleId | null, items: open.filter((i) => i.aisle === a) }))
      .filter((g) => g.items.length);
  }, [group, open, order]);

  const row = (i: ShoppingItem) => {
    if (editing?.id === i.id) {
      const set = (p: Partial<Editing>) => setEditing({ ...editing, ...p });
      const keys = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") void saveEdit();
        if (e.key === "Escape") setEditing(null);
      };
      return (
        <li key={i.id} className="shop__edit">
          <div className="shop__edit-row">
            <input
              autoFocus
              className="shop__field shop__field--name"
              value={editing.name}
              aria-label="Item"
              onChange={(e) => set({ name: e.target.value })}
              onKeyDown={keys}
            />
            <input
              className="shop__field shop__field--qty"
              value={editing.qty}
              placeholder="Qty"
              aria-label="Quantity"
              onChange={(e) => set({ qty: e.target.value })}
              onKeyDown={keys}
            />
          </div>
          <div className="shop__edit-row">
            <select
              className="shop__field"
              value={editing.aisle}
              aria-label="Aisle"
              onChange={(e) => set({ aisle: e.target.value as AisleId })}
            >
              {AISLES.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            <input
              className="shop__field shop__field--price"
              value={editing.price}
              placeholder="Price"
              inputMode="decimal"
              aria-label="Price"
              onChange={(e) => set({ price: e.target.value })}
              onKeyDown={keys}
            />
          </div>
          <input
            className="shop__field"
            value={editing.note}
            placeholder="Note (brand, size, for the party…)"
            aria-label="Note"
            onChange={(e) => set({ note: e.target.value })}
            onKeyDown={keys}
          />
          <div className="shop__edit-row shop__edit-actions">
            {lists.length > 1 && (
              <select
                className="shop__field"
                value={editing.listId}
                aria-label="List"
                onChange={(e) => set({ listId: e.target.value })}
              >
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.id === i.listId ? `On ${l.name}` : `Move to ${l.name}`}
                  </option>
                ))}
              </select>
            )}
            <span className="shop__grow" />
            <button type="button" className="shop__btn shop__btn--ghost" onClick={() => remove(i)}>
              <Trash2 size={13} /> Remove
            </button>
            <button type="button" className="shop__btn" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="button" className="shop__btn shop__btn--primary" onClick={() => void saveEdit()}>
              Save
            </button>
          </div>
        </li>
      );
    }
    return (
      <li key={i.id} className={`shop__item${i.checked ? " is-checked" : ""}`}>
        <button
          type="button"
          role="checkbox"
          aria-checked={i.checked}
          aria-label={i.checked ? `Put ${i.name} back on the list` : `Got ${i.name}`}
          className="shop__check"
          onClick={() => toggle(i)}
        >
          {i.checked && <Check size={12} strokeWidth={3} />}
        </button>
        <button type="button" className="shop__name" onClick={() => startEdit(i)} title="Edit">
          <span className="shop__title">
            {i.name}
            {i.qty && <span className="shop__qty">{i.qty}</span>}
          </span>
          {i.note && <span className="shop__note">{i.note}</span>}
        </button>
        {i.price !== null && <span className="shop__price">{money(i.price)}</span>}
        <div className="shop__actions">
          <button type="button" className="shop__icon" aria-label={`Edit ${i.name}`} onClick={() => startEdit(i)}>
            <Pencil size={13} />
          </button>
          <button type="button" className="shop__icon" aria-label={`Remove ${i.name}`} onClick={() => remove(i)}>
            <X size={14} />
          </button>
        </div>
      </li>
    );
  };

  return (
    <div className="shop">
      {/* list switcher */}
      <div className="shop__head">
        {naming ? (
          <input
            autoFocus
            className="shop__field shop__field--title"
            value={naming.value}
            placeholder={naming.mode === "new" ? "New list name, e.g. Hardware" : "List name"}
            onChange={(e) => setNaming({ ...naming, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveName();
              if (e.key === "Escape") setNaming(null);
            }}
            onBlur={() => void saveName()}
          />
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="shop__list-btn">
                <span>{deletingThis ? "…" : (list?.name ?? "No list")}</span>
                <ChevronDown size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="shop__menu">
              <DropdownMenuLabel>Lists</DropdownMenuLabel>
              {shownLists.map((l) => {
                const left = snapshot.shoppingItems.filter((i) => i.listId === l.id && !i.checked).length;
                return (
                  <DropdownMenuItem key={l.id} onSelect={() => setW({ shopListId: l.id })}>
                    <span className="shop__menu-check">{l.id === listId && <Check size={14} />}</span>
                    {l.name}
                    <span className="shop__menu-note">{left || ""}</span>
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setNaming({ mode: "new", value: "" })}>
                <ListPlus size={14} /> New list
              </DropdownMenuItem>
              {list && (
                <DropdownMenuItem onSelect={() => setNaming({ mode: "rename", value: list.name })}>
                  <Pencil size={14} /> Rename “{list.name}”
                </DropdownMenuItem>
              )}
              {list && shownLists.length > 1 && (
                <DropdownMenuItem variant="destructive" onSelect={deleteList}>
                  <Trash2 size={14} /> Delete “{list.name}”
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <span className="shop__count">
          {open.length ? `${open.length} to get` : items.length ? "All got" : ""}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="shop__icon" aria-label="List options">
              <MoreHorizontal size={15} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="shop__menu">
            <DropdownMenuCheckboxItem checked={group} onCheckedChange={(v) => setW({ shopGroup: v === true })}>
              Group by aisle
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!open.length || !list}
              onSelect={() => {
                if (!list) return;
                window.mypa.copyText(listAsText(list, items, order, { group, money }));
                setFlash({ text: "Copied. Paste it into a message." });
              }}
            >
              <ClipboardCopy size={14} /> Copy the list
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!cart.length}
              onSelect={() => listId && void actions.checkAllShopping(listId, false)}
            >
              <RotateCcw size={14} /> Put the cart back on the list
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!open.length}
              onSelect={() => listId && void actions.checkAllShopping(listId, true)}
            >
              <ShoppingCart size={14} /> Tick everything
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onOpenSettings}>
              <SlidersHorizontal size={14} /> Aisle order and settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* add */}
      <div className="shop__add">
        <div className="shop__addbox">
          <Plus size={15} className="shop__addicon" />
          <input
            ref={input}
            value={text}
            disabled={!listId}
            placeholder={listId ? "Add items: milk, 2 lb chicken, bread" : "Make a list first"}
            aria-label="Add items"
            aria-autocomplete="list"
            onChange={(e) => {
              setText(e.target.value);
              setPick(-1);
            }}
            onPaste={(e) => {
              const t = e.clipboardData.getData("text");
              if (t.includes("\n")) {
                e.preventDefault();
                void add(t);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && suggestions.length) {
                e.preventDefault();
                setPick((p) => (p + 1) % suggestions.length);
              } else if (e.key === "ArrowUp" && suggestions.length) {
                e.preventDefault();
                setPick((p) => (p <= 0 ? suggestions.length - 1 : p - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const s = suggestions[pick];
                if (s) {
                  const head = text.includes(",") ? text.slice(0, text.lastIndexOf(",") + 1) : "";
                  void add(`${head} ${s.qty ? `${s.qty} ` : ""}${s.name}`);
                } else void add(text);
              } else if (e.key === "Escape") {
                setText("");
                setPick(-1);
              }
            }}
          />
          <button
            type="button"
            className="shop__addbtn"
            disabled={!text.trim()}
            aria-label="Add"
            onClick={() => void add(text)}
          >
            <CornerDownLeft size={14} />
          </button>
        </div>
        {suggestions.length > 0 && (
          <ul className="shop__suggest" role="listbox">
            {suggestions.map((s, n) => (
              <li key={s.key} role="option" aria-selected={n === pick}>
                <button
                  type="button"
                  className={n === pick ? "is-on" : ""}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    const head = text.includes(",") ? text.slice(0, text.lastIndexOf(",") + 1) : "";
                    void add(`${head} ${s.qty ? `${s.qty} ` : ""}${s.name}`);
                  }}
                >
                  <span>{s.name}</span>
                  <span className="shop__suggest-meta">
                    {s.qty && `${s.qty} · `}
                    {aisleLabel(s.aisle)}
                    {s.count > 0 && ` · bought ${s.count}×`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {preview && !suggestions.length && <p className="shop__preview">{preview}</p>}
      </div>

      {/* buy again */}
      {again.length > 0 && listId && (
        <div className="shop__again">
          <button type="button" className="shop__again-head" onClick={() => setAgainOpen((v) => !v)}>
            {againOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Buy again
          </button>
          {againOpen && (
            <div className="shop__chips">
              {again.map((h) => (
                <span key={h.key} className="shop__chip">
                  <button type="button" onClick={() => addFromHistory(h)} title={`Add ${h.name}`}>
                    <Plus size={12} /> {h.name}
                  </button>
                  <button
                    type="button"
                    className="shop__chip-x"
                    aria-label={`Stop suggesting ${h.name}`}
                    title="Stop suggesting"
                    onClick={() => void actions.forgetShopping(h.name)}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* the list */}
      <div className="shop__body">
        {!listId ? (
          <div className="shop__empty">
            <p className="shop__empty-title">No lists yet</p>
            <button type="button" className="shop__btn shop__btn--primary" onClick={() => setNaming({ mode: "new", value: "" })}>
              <ListPlus size={14} /> Make a list
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="shop__empty">
            <p className="shop__empty-title">Nothing on {list?.name ?? "this list"}</p>
            <p>
              Type a few things, separated by commas, or paste a whole list. Quantities, notes and prices are
              understood: “2 lb chicken (skinless) @6.50”.
            </p>
          </div>
        ) : open.length === 0 ? (
          <div className="shop__empty shop__empty--small">
            <p className="shop__empty-title">Everything's in the cart</p>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.aisle ?? "all"} className="shop__aisle">
              {g.aisle && (
                <h4 className="shop__aisle-name">
                  {aisleLabel(g.aisle)} <span>{g.items.length}</span>
                </h4>
              )}
              <ul>{g.items.map(row)}</ul>
            </section>
          ))
        )}

        {cart.length > 0 && (
          <section className="shop__cart">
            <button type="button" className="shop__cart-head" onClick={() => setW({ shopCartOpen: !cartOpen })}>
              {cartOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <ShoppingCart size={13} />
              In the cart <span>{cart.length}</span>
              {cartTotal.priced > 0 && <span className="shop__cart-total">{money(cartTotal.total)}</span>}
            </button>
            {cartOpen && <ul>{cart.map(row)}</ul>}
          </section>
        )}
      </div>

      {/* done shopping */}
      {done ? (
        <div className="shop__done">
          <p className="shop__done-title">Done shopping?</p>
          <p className="shop__done-sub">
            Clears {cart.length} item{cart.length === 1 ? "" : "s"} from the cart and remembers them for Buy again.
          </p>
          {categories.length > 0 && (
            <label className="shop__done-log">
              <input type="checkbox" checked={done.log} onChange={(e) => setDone({ ...done, log: e.target.checked })} />
              Log in Expenses
            </label>
          )}
          {done.log && (
            <div className="shop__edit-row">
              <input
                autoFocus
                className="shop__field shop__field--price"
                value={done.amount}
                inputMode="decimal"
                placeholder="Spent"
                aria-label="Amount spent"
                onChange={(e) => setDone({ ...done, amount: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && finish()}
              />
              <select
                className="shop__field"
                value={done.category}
                aria-label="Category"
                onChange={(e) => setDone({ ...done, category: e.target.value })}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {done.log && cartTotal.priced > 0 && cartTotal.priced < cart.length && (
            <p className="shop__done-sub">
              Prices you added come to {money(cartTotal.total)} ({cartTotal.priced} of {cart.length} items).
            </p>
          )}
          <div className="shop__edit-row shop__edit-actions">
            <span className="shop__grow" />
            <button type="button" className="shop__btn" onClick={() => setDone(null)}>
              Not yet
            </button>
            <button type="button" className="shop__btn shop__btn--primary" onClick={finish}>
              <Check size={14} /> Done
            </button>
          </div>
        </div>
      ) : (
        (cart.length > 0 || allTotal.priced > 0) && (
          <footer className="shop__foot">
            <span>
              {allTotal.priced > 0 &&
                `About ${money(allTotal.total)}${allTotal.priced < items.length ? ` (${allTotal.priced} of ${items.length} priced)` : ""}`}
            </span>
            {cart.length > 0 && (
              <button type="button" className="shop__btn shop__btn--primary" onClick={startDone}>
                <Check size={14} /> Done shopping
              </button>
            )}
          </footer>
        )
      )}

      {flash && (flash.error || (!saved && !undo.latest)) && (
        <p className={`shop__flash${flash.error ? " is-error" : ""}`} role="status">
          {flash.text}
        </p>
      )}

      {undo.latest ? (
        <UndoToast
          key={undo.latest.id}
          label={undo.latest.label}
          onUndo={() => {
            const id = undo.latest!.id;
            undo.undo(id);
            if (id.startsWith("list:")) setW({ shopListId: id.slice(5) });
          }}
          onDismiss={() => undo.finish(undo.latest!.id)}
        />
      ) : (
        saved && (
          <UndoToast
            key={saved.key}
            label={saved.label}
            onUndo={() => {
              saved.undo();
              setSaved(null);
            }}
            onDismiss={() => setSaved(null)}
          />
        )
      )}
    </div>
  );
}

