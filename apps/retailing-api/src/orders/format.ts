const PESOS = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });

/** `1818000` centavos → `₱18,180.00`, for API messages. */
export const formatPesos = (amountMinor: number) => PESOS.format(amountMinor / 100);
