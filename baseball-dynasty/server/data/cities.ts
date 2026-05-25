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

// Real US / Canada / Mexico cities — 56 entries spanning all regions and all four market-size tiers.
// Activated by USE_REAL_CITIES=true in .env (takes effect on the next POST /api/league/new).
// All four quota tiers (mega ≥ 2, large ≥ 4, medium ≥ 8, small ≥ 6) are satisfied with
// six small cities each in a unique region so first-pass selection never needs to relax.
export const REAL_CITIES: CityData[] = [
  // Pacific Northwest
  { name: 'Seattle',      state: 'WA', region: 'Pacific Northwest', market_size: 'mega',   population_hint: 3950 },
  { name: 'Portland',     state: 'OR', region: 'Pacific Northwest', market_size: 'large',  population_hint: 2590 },
  { name: 'Spokane',      state: 'WA', region: 'Pacific Northwest', market_size: 'small',  population_hint: 590  },

  // Southwest
  { name: 'Phoenix',      state: 'AZ', region: 'Southwest', market_size: 'mega',   population_hint: 4870 },
  { name: 'Las Vegas',    state: 'NV', region: 'Southwest', market_size: 'large',  population_hint: 2230 },
  { name: 'Tucson',       state: 'AZ', region: 'Southwest', market_size: 'medium', population_hint: 1010 },
  { name: 'Albuquerque',  state: 'NM', region: 'Southwest', market_size: 'medium', population_hint: 920  },

  // Mountain West
  { name: 'Denver',           state: 'CO', region: 'Mountain West', market_size: 'mega',   population_hint: 2930 },
  { name: 'Salt Lake City',   state: 'UT', region: 'Mountain West', market_size: 'large',  population_hint: 1220 },
  { name: 'Boise',            state: 'ID', region: 'Mountain West', market_size: 'medium', population_hint: 750  },
  { name: 'Bozeman',          state: 'MT', region: 'Mountain West', market_size: 'small',  population_hint: 115  },

  // Midwest
  { name: 'Chicago',      state: 'IL', region: 'Midwest', market_size: 'mega',   population_hint: 9500 },
  { name: 'Detroit',      state: 'MI', region: 'Midwest', market_size: 'large',  population_hint: 4400 },
  { name: 'Minneapolis',  state: 'MN', region: 'Midwest', market_size: 'large',  population_hint: 3640 },
  { name: 'Milwaukee',    state: 'WI', region: 'Midwest', market_size: 'large',  population_hint: 1570 },
  { name: 'Indianapolis', state: 'IN', region: 'Midwest', market_size: 'large',  population_hint: 2110 },
  { name: 'Columbus',     state: 'OH', region: 'Midwest', market_size: 'large',  population_hint: 2120 },
  { name: 'Cincinnati',   state: 'OH', region: 'Midwest', market_size: 'medium', population_hint: 2280 },

  // Great Plains
  { name: 'Kansas City',    state: 'MO', region: 'Great Plains', market_size: 'large',  population_hint: 2190 },
  { name: 'Oklahoma City',  state: 'OK', region: 'Great Plains', market_size: 'medium', population_hint: 1410 },
  { name: 'Omaha',          state: 'NE', region: 'Great Plains', market_size: 'medium', population_hint: 950  },
  { name: 'Wichita',        state: 'KS', region: 'Great Plains', market_size: 'medium', population_hint: 640  },
  { name: 'Sioux Falls',    state: 'SD', region: 'Great Plains', market_size: 'small',  population_hint: 280  },

  // South
  { name: 'Dallas',          state: 'TX', region: 'South', market_size: 'mega',   population_hint: 7450 },
  { name: 'Houston',         state: 'TX', region: 'South', market_size: 'mega',   population_hint: 7100 },
  { name: 'San Antonio',     state: 'TX', region: 'South', market_size: 'large',  population_hint: 2550 },
  { name: 'Austin',          state: 'TX', region: 'South', market_size: 'large',  population_hint: 2220 },
  { name: 'New Orleans',     state: 'LA', region: 'South', market_size: 'medium', population_hint: 1290 },
  { name: 'Corpus Christi',  state: 'TX', region: 'South', market_size: 'small',  population_hint: 440  },

  // Southeast
  { name: 'Atlanta',    state: 'GA', region: 'Southeast', market_size: 'mega',   population_hint: 6140 },
  { name: 'Miami',      state: 'FL', region: 'Southeast', market_size: 'large',  population_hint: 6200 },
  { name: 'Tampa',      state: 'FL', region: 'Southeast', market_size: 'large',  population_hint: 3120 },
  { name: 'Charlotte',  state: 'NC', region: 'Southeast', market_size: 'large',  population_hint: 2700 },
  { name: 'Nashville',  state: 'TN', region: 'Southeast', market_size: 'large',  population_hint: 2010 },
  { name: 'Raleigh',    state: 'NC', region: 'Southeast', market_size: 'medium', population_hint: 1410 },
  { name: 'Memphis',    state: 'TN', region: 'Southeast', market_size: 'medium', population_hint: 1340 },

  // Mid-Atlantic
  { name: 'New York',     state: 'NY', region: 'Mid-Atlantic', market_size: 'mega',   population_hint: 20140 },
  { name: 'Philadelphia', state: 'PA', region: 'Mid-Atlantic', market_size: 'mega',   population_hint: 6230  },
  { name: 'Washington',   state: 'DC', region: 'Mid-Atlantic', market_size: 'mega',   population_hint: 6360  },
  { name: 'Baltimore',    state: 'MD', region: 'Mid-Atlantic', market_size: 'large',  population_hint: 2900  },
  { name: 'Pittsburgh',   state: 'PA', region: 'Mid-Atlantic', market_size: 'large',  population_hint: 2370  },
  { name: 'Richmond',     state: 'VA', region: 'Mid-Atlantic', market_size: 'medium', population_hint: 1340  },

  // New England
  { name: 'Boston',     state: 'MA', region: 'New England', market_size: 'mega',   population_hint: 4920 },
  { name: 'Hartford',   state: 'CT', region: 'New England', market_size: 'medium', population_hint: 1210 },
  { name: 'Providence', state: 'RI', region: 'New England', market_size: 'medium', population_hint: 1640 },
  { name: 'Portland',   state: 'ME', region: 'New England', market_size: 'small',  population_hint: 550  },

  // Canada
  { name: 'Toronto',    state: 'ON', region: 'Canada', market_size: 'mega',   population_hint: 6500 },
  { name: 'Vancouver',  state: 'BC', region: 'Canada', market_size: 'large',  population_hint: 2640 },
  { name: 'Montreal',   state: 'QC', region: 'Canada', market_size: 'large',  population_hint: 4020 },
  { name: 'Calgary',    state: 'AB', region: 'Canada', market_size: 'large',  population_hint: 1490 },
  { name: 'Edmonton',   state: 'AB', region: 'Canada', market_size: 'medium', population_hint: 1420 },
  { name: 'Ottawa',     state: 'ON', region: 'Canada', market_size: 'medium', population_hint: 1390 },

  // Mexico
  { name: 'Monterrey',   state: 'NL',  region: 'Mexico', market_size: 'large',  population_hint: 5100 },
  { name: 'Guadalajara', state: 'JAL', region: 'Mexico', market_size: 'large',  population_hint: 5270 },
  { name: 'Tijuana',     state: 'BC',  region: 'Mexico', market_size: 'medium', population_hint: 2020 },

  // Appalachian
  { name: 'Knoxville',  state: 'TN', region: 'Appalachian', market_size: 'medium', population_hint: 880 },
  { name: 'Charleston', state: 'WV', region: 'Appalachian', market_size: 'small',  population_hint: 270 },
];
