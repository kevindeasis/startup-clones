import type { Profile } from "../src/lib/types";

export const profile: Profile = {
  id: "default",
  name: "Northline Pump & Valve",
  description: "Pumps and valves.",
  categories: ["water", "wastewater", "stormwater"],
  keywords: ["pump", "pump station", "lift station", "valve", "SCADA", "VFD", "wet well", "force main", "booster"],
  regions: ["Brightwater County", "Copperline County"],
  minValue: 100000,
  maxValue: 15000000,
  certifications: ["AWWA C-series", "NSF/ANSI 61", "UL 508A panels"],
  bondingCapacity: 5000000,
  team: [
    { name: "Dana", role: "Regional Sales Lead" },
    { name: "Marcus", role: "Application Engineer" },
    { name: "Priya", role: "Estimator & Contracts Admin" },
  ],
  pastBids: [],
};
