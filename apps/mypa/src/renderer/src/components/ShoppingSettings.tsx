import { ArrowDown, ArrowUp } from "lucide-react";

import { aisleLabel, DEFAULT_SHOPPING_SETTINGS, type AisleId } from "../../../shared/shopping";
import type { WidgetRow } from "../../../shared/types";
import { useReadyStore } from "../lib/store";

export function ShoppingSettingsForm({ widget }: { widget: WidgetRow }) {
  const { snapshot, actions } = useReadyStore();
  const s = snapshot.meta.shopping;
  const order = s.aisleOrder;
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j]!, next[i]!];
    void actions.setShoppingSettings({ aisleOrder: next as AisleId[] });
  };
  const changed = order.join() !== DEFAULT_SHOPPING_SETTINGS.aisleOrder.join();

  return (
    <>
      <label className="wsettings__toggle">
        <input
          type="checkbox"
          checked={widget.settings.shopGroup !== false}
          onChange={(e) => void actions.updateWidgetSettings(widget.id, { shopGroup: e.target.checked })}
        />
        <span>
          Group items by aisle
          <small>In the order below, so the list follows your walk through the shop.</small>
        </span>
      </label>

      <div className="wsettings__field">
        <span className="wsettings__label">Aisle order of your shop</span>
        <ol className="shopset__aisles">
          {order.map((a, i) => (
            <li key={a}>
              <span>{aisleLabel(a)}</span>
              <button type="button" aria-label={`Move ${aisleLabel(a)} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp size={13} />
              </button>
              <button
                type="button"
                aria-label={`Move ${aisleLabel(a)} down`}
                disabled={i === order.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown size={13} />
              </button>
            </li>
          ))}
        </ol>
        {changed && (
          <button
            type="button"
            className="wsettings__link"
            onClick={() => void actions.setShoppingSettings({ aisleOrder: DEFAULT_SHOPPING_SETTINGS.aisleOrder })}
          >
            Reset the order
          </button>
        )}
        <small className="wsettings__hint">
          Move an item to another aisle (click it to edit) and it's remembered for next time.
        </small>
      </div>

      <label className="wsettings__toggle">
        <input
          type="checkbox"
          checked={s.logExpense}
          onChange={(e) => void actions.setShoppingSettings({ logExpense: e.target.checked })}
        />
        <span>
          Offer to log trips in Expenses
          <small>“Done shopping” asks what you spent and adds it as an expense.</small>
        </span>
      </label>
      {s.logExpense && snapshot.expenseCategories.length > 0 && (
        <div className="wsettings__field">
          <label className="wsettings__label" htmlFor="shop-cat">
            Usual category
          </label>
          <select
            id="shop-cat"
            className="wsettings__input"
            value={s.expenseCategory}
            onChange={(e) => void actions.setShoppingSettings({ expenseCategory: e.target.value })}
          >
            {snapshot.expenseCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
