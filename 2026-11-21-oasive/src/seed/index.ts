import type { DocType, Sector } from "@/lib/types";

export type SeedObligor = {
  id: string; name: string; aliases: string[]; state: string; sector: Sector; description: string;
};

export const SEED_OBLIGORS: SeedObligor[] = [
  {
    id: "ashford-falls", name: "City of Ashford Falls", aliases: ["Ashford Falls", "Ashford Falls, Ohio"], state: "OH", sector: "city",
    description: "Fictional mid-sized Ohio city (pop. ~61,000) with a shrinking general fund balance, now under state fiscal oversight.",
  },
  {
    id: "cedar-valley-county", name: "Cedar Valley County", aliases: ["Cedar Valley", "Cedar Valley County Board"], state: "IA", sector: "county",
    description: "Fictional Iowa county (pop. ~148,000) with healthy reserves, a leadership change and a shared-dispatch dispute.",
  },
  {
    id: "brightwater-health", name: "Brightwater Health System", aliases: ["Brightwater Health", "Brightwater Hospital", "BWHS"], state: "PA", sector: "hospital",
    description: "Fictional two-hospital regional health system in western Pennsylvania under covenant pressure as liquidity falls.",
  },
  {
    id: "tri-lakes-water", name: "Tri-Lakes Water & Sewer Authority", aliases: ["Tri-Lakes Water Authority", "Tri-Lakes Water & Sewer", "Tri-Lakes Authority"], state: "TX", sector: "water_utility",
    description: "Fictional north Texas water and sewer authority raising rates and funding a plant expansion with new revenue bonds.",
  },
  {
    id: "northstar-charter", name: "Northstar Charter Academies", aliases: ["Northstar Charter", "Northstar Academies"], state: "AZ", sector: "school",
    description: "Fictional eleven-campus Arizona charter-school network with declining enrollment and thinning liquidity.",
  },
  {
    id: "summit-regional-airport", name: "Summit Regional Airport Authority", aliases: ["Summit Regional Airport", "Summit Airport Authority"], state: "CO", sector: "airport",
    description: "Fictional Colorado small-hub airport with recovering passenger traffic and strong coverage.",
  },
];

export type SeedDoc = { file: string; obligorId: string; title: string; type: DocType; fiscalYear: number };

export const SEED_DOCS: SeedDoc[] = [
  { file: "ashford-acfr.txt", obligorId: "ashford-falls", title: "Ashford Falls ACFR FY2022-FY2024", type: "audit", fiscalYear: 2024 },
  { file: "ashford-os.txt", obligorId: "ashford-falls", title: "Ashford Falls Official Statement GO Series 2025", type: "official_statement", fiscalYear: 2024 },
  { file: "ashford-minutes.txt", obligorId: "ashford-falls", title: "Ashford Falls City Council Minutes (special session)", type: "board_minutes", fiscalYear: 2026 },
  { file: "cedar-audit.txt", obligorId: "cedar-valley-county", title: "Cedar Valley County Annual Financial Report FY2022-FY2024", type: "audit", fiscalYear: 2024 },
  { file: "cedar-minutes.txt", obligorId: "cedar-valley-county", title: "Cedar Valley County Board Minutes", type: "board_minutes", fiscalYear: 2026 },
  { file: "brightwater-audit.txt", obligorId: "brightwater-health", title: "Brightwater Health Audited Financials FY2022-FY2024", type: "audit", fiscalYear: 2024 },
  { file: "brightwater-os.txt", obligorId: "brightwater-health", title: "Brightwater Health Official Statement Series 2026", type: "official_statement", fiscalYear: 2024 },
  { file: "brightwater-minutes.txt", obligorId: "brightwater-health", title: "Brightwater Health Board of Trustees Minutes", type: "board_minutes", fiscalYear: 2026 },
  { file: "trilakes-audit.txt", obligorId: "tri-lakes-water", title: "Tri-Lakes Water Audited Financials FY2022-FY2024", type: "audit", fiscalYear: 2024 },
  { file: "trilakes-os.txt", obligorId: "tri-lakes-water", title: "Tri-Lakes Water Official Statement Series 2026", type: "official_statement", fiscalYear: 2024 },
  { file: "trilakes-minutes.txt", obligorId: "tri-lakes-water", title: "Tri-Lakes Water Board Minutes", type: "board_minutes", fiscalYear: 2026 },
  { file: "northstar-audit.txt", obligorId: "northstar-charter", title: "Northstar Charter Audited Financials FY2022-FY2024", type: "audit", fiscalYear: 2024 },
  { file: "northstar-minutes.txt", obligorId: "northstar-charter", title: "Northstar Charter Governing Board Minutes", type: "board_minutes", fiscalYear: 2026 },
  { file: "summit-audit.txt", obligorId: "summit-regional-airport", title: "Summit Regional Airport Audited Financials FY2022-FY2024", type: "audit", fiscalYear: 2024 },
  { file: "summit-minutes.txt", obligorId: "summit-regional-airport", title: "Summit Regional Airport Board Minutes", type: "board_minutes", fiscalYear: 2026 },
];

export type SeedNews = { id: string; daysAgo: number; source: string; title: string; text: string };

export const SEED_NEWS: SeedNews[] = [
  {
    id: "news-seed-01", daysAgo: 3, source: "Allegheny Ledger",
    title: "Brightwater Health tells bondholders it missed a debt service coverage covenant",
    text: "Brightwater Health System disclosed to bondholders that its fiscal 2024 debt service coverage fell to 1.12 times, below the 1.20 times required under the master trust indenture covering $212 million of Series 2019 bonds. The system said it has obtained a waiver from the trustee and will present a liquidity plan to its board.",
  },
  {
    id: "news-seed-02", daysAgo: 9, source: "Ashford Falls Courier",
    title: "State places Ashford Falls under fiscal oversight",
    text: "The State Auditor declared a fiscal emergency in Ashford Falls and appointed a supervision commission to approve the city's budget. City officials said the general fund deficit of $14.2 million left no alternative. The commission can require layoffs and service cuts.",
  },
  {
    id: "news-seed-03", daysAgo: 5, source: "Desert Business Journal",
    title: "Moody's downgrades Northstar Charter Academies to Ba2 as enrollment slides",
    text: "Moody's downgraded Northstar Charter Academies to Ba2 from Ba1 and kept a negative outlook, citing four straight years of enrollment losses and falling liquidity. The network has $128 million of bonds outstanding. Management said it is reviewing its campus footprint.",
  },
  {
    id: "news-seed-04", daysAgo: 14, source: "North Texas Gazette",
    title: "Tri-Lakes Water board approves another 6.5% rate increase",
    text: "The Tri-Lakes Water & Sewer Authority board voted 5-0 for a 6.5% rate increase effective January 1 to pay for treatment plant improvements. Authority staff said the increase keeps coverage comfortably above bond requirements.",
  },
  {
    id: "news-seed-05", daysAgo: 20, source: "Bond Buyer Local Wire",
    title: "Tri-Lakes Authority prices $85 million of revenue bonds",
    text: "Tri-Lakes Water & Sewer Authority priced $85 million of Series 2026 revenue bonds to fund the Lake Ridge plant expansion. The bonds are rated A2 and received strong investor demand.",
  },
  {
    id: "news-seed-06", daysAgo: 27, source: "Mountain Times",
    title: "Fitch revises Summit Regional Airport outlook to positive",
    text: "Fitch revised its outlook on Summit Regional Airport Authority to positive from stable, citing passenger traffic that has surpassed pre-pandemic levels and debt service coverage of 1.74 times. The airport's A3-equivalent rating was affirmed.",
  },
  {
    id: "news-seed-07", daysAgo: 33, source: "Cedar Valley Herald",
    title: "Cedar Valley County administrator resigns",
    text: "Cedar Valley County Administrator Gwen Tallis announced her resignation, effective at the end of the quarter. Supervisors said they will launch a national search and appoint an interim administrator.",
  },
  {
    id: "news-seed-08", daysAgo: 18, source: "Midwest Municipal Review",
    title: "Ashford Falls and Cedar Valley County trade lawsuits over 911 dispatch costs",
    text: "Cedar Valley County is suing the City of Ashford Falls for $3.2 million in unpaid shared 911 dispatch costs. Ashford Falls officials said the city disputes the amount and is seeking mediation.",
  },
  {
    id: "news-seed-09", daysAgo: 11, source: "Allegheny Ledger",
    title: "Brightwater Health lays off 140 workers as CFO resigns",
    text: "Brightwater Health System laid off 140 employees and said Chief Financial Officer Mr. Hale will resign. The system reported a year-to-date deficit of $9.4 million driven by contract labor.",
  },
  {
    id: "news-seed-10", daysAgo: 6, source: "Ashford Falls Courier",
    title: "Ashford Falls Fall Harvest Festival draws record crowds",
    text: "More than 20,000 people visited the Ashford Falls Harvest Festival over the weekend, with a pie contest, live music and a pumpkin parade down Main Street. Organizers thanked volunteers.",
  },
  {
    id: "news-seed-11", daysAgo: 22, source: "Desert Business Journal",
    title: "Northstar Charter robotics team wins state championship",
    text: "Students from Northstar Charter Academies took first place at the state robotics championship on Saturday. The team will advance to nationals in the spring.",
  },
  {
    id: "news-seed-12", daysAgo: 40, source: "Mountain Times",
    title: "Summit Regional Airport opens new coffee shop in Terminal B",
    text: "Travelers at Summit Regional Airport can now grab a latte at a locally owned coffee shop that opened this week in Terminal B.",
  },
  {
    id: "news-seed-13", daysAgo: 50, source: "Cedar Valley Herald",
    title: "Cedar Valley supervisors adopt budget with $2.4 million deficit",
    text: "Cedar Valley County supervisors adopted a fiscal 2027 budget that carries a projected deficit of $2.4 million, to be covered from reserves. Officials said property tax rates will not rise.",
  },
];
