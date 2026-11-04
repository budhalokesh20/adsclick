export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
}

const CURRENCIES: CurrencyInfo[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2 },
  { code: 'GBP', name: 'British Pound', symbol: '£', decimals: 2 },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', decimals: 2 },
  { code: 'NPR', name: 'Nepalese Rupee', symbol: 'रू', decimals: 2 },
  { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳', decimals: 2 },
  { code: 'PKR', name: 'Pakistani Rupee', symbol: '₨', decimals: 2 },
  { code: 'LKR', name: 'Sri Lankan Rupee', symbol: '₨', decimals: 2 },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', decimals: 2 },
  { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼', decimals: 2 },
  { code: 'QAR', name: 'Qatari Riyal', symbol: '﷼', decimals: 2 },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', decimals: 2 },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', decimals: 2 },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', decimals: 0 },
  { code: 'THB', name: 'Thai Baht', symbol: '฿', decimals: 2 },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫', decimals: 0 },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱', decimals: 2 },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', decimals: 2 },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', decimals: 0 },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩', decimals: 0 },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', decimals: 2 },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', decimals: 2 },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', decimals: 2 },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'Mex$', decimals: 2 },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', decimals: 2 },
  { code: 'ARS', name: 'Argentine Peso', symbol: '$', decimals: 2 },
  { code: 'CLP', name: 'Chilean Peso', symbol: '$', decimals: 0 },
  { code: 'COP', name: 'Colombian Peso', symbol: '$', decimals: 0 },
  { code: 'PEN', name: 'Peruvian Sol', symbol: 'S/', decimals: 2 },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'Fr', decimals: 2 },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺', decimals: 2 },
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£', decimals: 2 },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', decimals: 2 },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', decimals: 2 },
  { code: 'RUB', name: 'Russian Ruble', symbol: '₽', decimals: 2 },
  { code: 'UAH', name: 'Ukrainian Hryvnia', symbol: '₴', decimals: 2 },
  { code: 'ILS', name: 'Israeli Shekel', symbol: '₪', decimals: 2 },
  { code: 'KZT', name: 'Kazakhstani Tenge', symbol: '₸', decimals: 2 },
];

const COUNTRY_CURRENCY: Record<string, string> = {
  US: 'USD', GB: 'GBP', IN: 'INR', NP: 'NPR', BD: 'BDT', PK: 'PKR',
  LK: 'LKR', AE: 'AED', SA: 'SAR', QA: 'QAR', SG: 'SGD', MY: 'MYR',
  ID: 'IDR', TH: 'THB', VN: 'VND', PH: 'PHP', CN: 'CNY', JP: 'JPY',
  KR: 'KRW', AU: 'AUD', NZ: 'NZD', CA: 'CAD', MX: 'MXN', BR: 'BRL',
  AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN', DE: 'EUR', FR: 'EUR',
  IT: 'EUR', ES: 'EUR', PT: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR',
  CH: 'CHF', SE: 'EUR', NO: 'EUR', DK: 'EUR', FI: 'EUR', PL: 'EUR',
  TR: 'TRY', EG: 'EGP', NG: 'NGN', ZA: 'ZAR', RU: 'RUB', UA: 'UAH',
  IL: 'ILS', KZ: 'KZT',
};

export function listCurrencies(): CurrencyInfo[] {
  return CURRENCIES;
}

export function resolveCurrency(countryCode?: string | null): CurrencyInfo {
  if (!countryCode) return { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2 };
  const code = COUNTRY_CURRENCY[countryCode] ?? 'USD';
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0]!;
}
