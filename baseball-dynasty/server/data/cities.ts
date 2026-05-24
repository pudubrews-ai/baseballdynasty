// Fictional cities for world generation — no real city names
// Each city has region, market_size, and population_hint

export interface CityData {
  name: string;
  state: string;
  region: string;
  market_size: 'mega' | 'large' | 'medium' | 'small';
  population_hint: number; // thousands
}

export const CITIES: CityData[] = [
  // Pacific Northwest
  { name: 'Port Cascadia', state: 'WA', region: 'Pacific Northwest', market_size: 'large', population_hint: 720 },
  { name: 'Valmora', state: 'OR', region: 'Pacific Northwest', market_size: 'medium', population_hint: 380 },
  { name: 'Silverpine', state: 'WA', region: 'Pacific Northwest', market_size: 'small', population_hint: 180 },

  // Southwest
  { name: 'Fort Dulce', state: 'AZ', region: 'Southwest', market_size: 'mega', population_hint: 1650 },
  { name: 'Mesaverde', state: 'NM', region: 'Southwest', market_size: 'medium', population_hint: 420 },
  { name: 'Cactus Flats', state: 'AZ', region: 'Southwest', market_size: 'small', population_hint: 210 },

  // Mountain West
  { name: 'Cresthaven', state: 'CO', region: 'Mountain West', market_size: 'large', population_hint: 680 },
  { name: 'Lake Hensley', state: 'UT', region: 'Mountain West', market_size: 'medium', population_hint: 390 },
  { name: 'Rimrock', state: 'MT', region: 'Mountain West', market_size: 'small', population_hint: 95 },

  // Midwest
  { name: 'Ironport', state: 'OH', region: 'Midwest', market_size: 'large', population_hint: 790 },
  { name: 'Lakewell', state: 'IL', region: 'Midwest', market_size: 'mega', population_hint: 2200 },
  { name: 'Millhaven', state: 'IN', region: 'Midwest', market_size: 'medium', population_hint: 340 },
  { name: 'Coldwater Falls', state: 'MN', region: 'Midwest', market_size: 'medium', population_hint: 460 },

  // Great Plains
  { name: 'Prairie Cross', state: 'KS', region: 'Great Plains', market_size: 'medium', population_hint: 310 },
  { name: 'Redstone City', state: 'OK', region: 'Great Plains', market_size: 'medium', population_hint: 560 },
  { name: 'Flinthills', state: 'NE', region: 'Great Plains', market_size: 'small', population_hint: 145 },

  // South
  { name: 'Cedarwood', state: 'TX', region: 'South', market_size: 'mega', population_hint: 2900 },
  { name: 'Pinecrest', state: 'TX', region: 'South', market_size: 'large', population_hint: 710 },
  { name: 'Bayou Vista', state: 'LA', region: 'South', market_size: 'medium', population_hint: 480 },

  // Southeast
  { name: 'Magnolia Bay', state: 'GA', region: 'Southeast', market_size: 'large', population_hint: 610 },
  { name: 'Clearwater Bluffs', state: 'FL', region: 'Southeast', market_size: 'large', population_hint: 580 },
  { name: 'Stoneharbor', state: 'NC', region: 'Southeast', market_size: 'medium', population_hint: 290 },
  { name: 'Tupelo Heights', state: 'TN', region: 'Southeast', market_size: 'medium', population_hint: 370 },

  // Mid-Atlantic
  { name: 'Harrowgate', state: 'PA', region: 'Mid-Atlantic', market_size: 'mega', population_hint: 1800 },
  { name: 'Riverstone', state: 'VA', region: 'Mid-Atlantic', market_size: 'large', population_hint: 660 },
  { name: 'Chesapeake Bluff', state: 'MD', region: 'Mid-Atlantic', market_size: 'medium', population_hint: 420 },

  // New England
  { name: 'Dunmoor', state: 'MA', region: 'New England', market_size: 'mega', population_hint: 1500 },
  { name: 'Coldbrook', state: 'CT', region: 'New England', market_size: 'medium', population_hint: 280 },
  { name: 'Harborwatch', state: 'ME', region: 'New England', market_size: 'small', population_hint: 120 },

  // Canada
  { name: 'Thunder Ridge', state: 'ON', region: 'Canada', market_size: 'large', population_hint: 820 },
  { name: 'Westgate', state: 'BC', region: 'Canada', market_size: 'medium', population_hint: 410 },

  // Mexico
  { name: 'Puebla del Norte', state: 'NL', region: 'Mexico', market_size: 'medium', population_hint: 850 },

  // Appalachian (added for market-size quota — §2.11)
  { name: 'Ironbrook', state: 'WV', region: 'Appalachian', market_size: 'small', population_hint: 88 },
];
