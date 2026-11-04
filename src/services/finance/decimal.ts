import { Decimal } from 'decimal.js';

Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

export const D6 = 6;

export function toDecimal(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

/** Rounds to 6 decimal places (half-up). */
export function round6(value: Decimal | Decimal.Value): Decimal {
  return new Decimal(value).toDecimalPlaces(D6);
}

/** Percentage allocation: gross * pct / 100, rounded to 6 dp. */
export function share(gross: Decimal, pct: Decimal | number): Decimal {
  return round6(gross.mul(new Decimal(pct)).div(100));
}

export function moneyString(value: Decimal | string | number): string {
  return new Decimal(value).toString();
}
