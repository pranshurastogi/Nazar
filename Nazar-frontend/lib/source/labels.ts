// Display names for the codes alerts carry. State codes follow the backend's pin-code
// table (Nazar-backend/src/resolve/manufacturer.ts), which keeps IN-TS and IN-UK.

export const STATE_NAME: Record<string, string> = {
  'IN-AN': 'Andaman and Nicobar Islands',
  'IN-AP': 'Andhra Pradesh',
  'IN-AR': 'Arunachal Pradesh',
  'IN-AS': 'Assam',
  'IN-BR': 'Bihar',
  'IN-CG': 'Chhattisgarh',
  'IN-CH': 'Chandigarh',
  'IN-DH': 'Dadra and Nagar Haveli and Daman and Diu',
  'IN-DL': 'Delhi',
  'IN-GA': 'Goa',
  'IN-GJ': 'Gujarat',
  'IN-HP': 'Himachal Pradesh',
  'IN-HR': 'Haryana',
  'IN-JH': 'Jharkhand',
  'IN-JK': 'Jammu and Kashmir',
  'IN-KA': 'Karnataka',
  'IN-KL': 'Kerala',
  'IN-LA': 'Ladakh',
  'IN-LD': 'Lakshadweep',
  'IN-MH': 'Maharashtra',
  'IN-ML': 'Meghalaya',
  'IN-MN': 'Manipur',
  'IN-MP': 'Madhya Pradesh',
  'IN-MZ': 'Mizoram',
  'IN-NL': 'Nagaland',
  'IN-OD': 'Odisha',
  'IN-PB': 'Punjab',
  'IN-PY': 'Puducherry',
  'IN-RJ': 'Rajasthan',
  'IN-SK': 'Sikkim',
  'IN-TN': 'Tamil Nadu',
  'IN-TR': 'Tripura',
  'IN-TS': 'Telangana',
  'IN-UK': 'Uttarakhand',
  'IN-UP': 'Uttar Pradesh',
  'IN-WB': 'West Bengal',
}

/** Pipeline sources, as listed by /v1/sources. */
export const SOURCE_NAME: Record<string, string> = {
  'cdsco-online': 'CDSCO NSQ portal',
  'cdsco-pdf': 'CDSCO drug alerts',
  'tn-dc': 'Tamil Nadu Drugs Control',
  'mh-fda': 'Maharashtra FDA',
  'who-mpa': 'WHO product alerts',
}

export const stateName = (code: string | null) => (code ? (STATE_NAME[code] ?? code) : null)
