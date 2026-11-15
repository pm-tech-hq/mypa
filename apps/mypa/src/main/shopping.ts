/**
 * Shopping Lists in the main process: adding (merging duplicates), editing,
 * and "done shopping", which remembers what was bought (for Buy again and
 * aisle memory) and can log the trip in Expenses.
 */
import { ipcMain } from "electron";

import { IPC } from "../shared/api";
import {
  itemKey,
  parseItems,
  planAdds,
  type ShoppingItem,
  type ShoppingSettings,
} from "../shared/shopping";
import * as db from "./db";

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Adds what was typed to a list; returns the ids it created or changed. */
export function addToList(listId: string, text: string): { created: string[]; changed: string[]; names: string[] } {
  if (!db.getShoppingList(listId)) throw new Error("That list is gone.");
  const parsed = parseItems(text);
  if (!parsed.length) throw new Error("Type what to buy, like “milk, 2 lb chicken, bread”.");
  const plan = planAdds(parsed, db.listShoppingItems(listId), db.listShoppingHistory());
  const created: string[] = [];
  const changed: string[] = [];
  const names: string[] = [];
  for (const o of plan) {
    if (o.kind === "new") {
      created.push(
        db.insertShoppingItem({
          listId,
          name: o.item.name,
          qty: o.item.qty,
          note: o.item.note,
          price: o.item.price,
          aisle: o.aisle,
        }),
      );
      names.push(o.item.name);
    } else if (o.kind === "more") {
      db.updateShoppingItem(o.id, { qty: o.qty, price: o.price });
      changed.push(o.id);
      names.push(o.name);
    } else {
      db.updateShoppingItem(o.id, { qty: o.qty, checked: false });
      changed.push(o.id);
      names.push(o.name);
    }
  }
  return { created, changed, names };
}

/** Clears the cart: remembers each item as bought, logs the spend if asked. */
export function finishShopping(
  listId: string,
  expense: { amount: number; categoryId: string; note: string } | null,
): { cleared: number; expenseId: string | null } {
  const bought = db.listShoppingItems(listId).filter((i) => i.checked);
  for (const i of bought) db.recordBought(i);
  db.deleteShoppingItems(bought.map((i) => i.id));
  let expenseId: string | null = null;
  if (expense && expense.amount > 0) {
    expenseId = db.createExpense({
      amount: Math.round(expense.amount),
      categoryId: expense.categoryId,
      note: expense.note,
      date: today(),
    });
  }
  return { cleared: bought.length, expenseId };
}

export function registerShoppingHandlers(snap: () => unknown): void {
  const write = (fn: () => void) => {
    fn();
    db.flush();
    return snap();
  };
  ipcMain.handle(IPC.shopListCreate, (_e, name: string) => {
    const id = db.createShoppingList(String(name ?? ""));
    db.flush();
    return { id, snapshot: snap() };
  });
  ipcMain.handle(IPC.shopListRename, (_e, id: string, name: string) =>
    write(() => db.renameShoppingList(String(id), String(name ?? ""))),
  );
  ipcMain.handle(IPC.shopListDelete, (_e, id: string) => write(() => db.deleteShoppingList(String(id))));
  ipcMain.handle(IPC.shopAdd, (_e, listId: string, text: string) => {
    const r = addToList(String(listId), String(text ?? ""));
    db.flush();
    return { ...r, snapshot: snap() };
  });
  ipcMain.handle(IPC.shopUpdate, (_e, id: string, patch: Partial<ShoppingItem>) =>
    write(() => db.updateShoppingItem(String(id), patch ?? {})),
  );
  ipcMain.handle(IPC.shopPut, (_e, items: ShoppingItem[]) =>
    write(() => db.putShoppingItems(Array.isArray(items) ? items : [])),
  );
  ipcMain.handle(IPC.shopDelete, (_e, ids: string[]) =>
    write(() => db.deleteShoppingItems(Array.isArray(ids) ? ids.map(String) : [])),
  );
  ipcMain.handle(IPC.shopCheckAll, (_e, listId: string, checked: boolean) =>
    write(() => {
      for (const i of db.listShoppingItems(String(listId))) {
        if (i.checked !== (checked === true)) db.updateShoppingItem(i.id, { checked: checked === true });
      }
    }),
  );
  ipcMain.handle(
    IPC.shopFinish,
    (_e, listId: string, expense: { amount: number; categoryId: string; note: string } | null) =>
      write(() => void finishShopping(String(listId), expense ?? null)),
  );
  ipcMain.handle(IPC.shopForget, (_e, name: string) => write(() => db.forgetShoppingHistory(itemKey(String(name)))));
  ipcMain.handle(IPC.shopSettings, (_e, patch: Partial<ShoppingSettings>) =>
    write(() => db.setShoppingSettings(patch ?? {})),
  );
}
